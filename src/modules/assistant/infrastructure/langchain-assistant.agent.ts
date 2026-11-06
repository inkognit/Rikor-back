import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, createAgent, createMiddleware, HumanMessage, ToolMessage } from 'langchain';
import type { AssistantAgent } from '../application/assistant-agent.port';
import { LlmError } from '../application/errors';
import type { PreferencesService } from '../application/preferences.service';
import { toLlmError } from './llm-errors';
import { ModelCallRetryOptions, retryModelCalls } from './model-call.retry';
import { createPreferenceTools, SAVE_PREFERENCE_TOOL } from './preference.tools';
import { buildFinalAnswerPrompt, SYSTEM_PROMPT } from './system-prompt';

export interface AgentOptions extends ModelCallRetryOptions {
  timeoutMs: number;
  /** После стольких обращений на чтение модель обязана ответить тем, что уже получила. Запись не считается. */
  maxToolRounds: number;
  /** Страховка на случай, если модель не подчинится: вызов модели и инструментов считаются отдельными шагами. */
  recursionLimit: number;
}

export class LangchainAssistantAgent implements AssistantAgent {
  constructor(
    private readonly model: BaseChatModel,
    private readonly preferences: PreferencesService,
    private readonly options: AgentOptions,
  ) {}

  async reply(userId: string, message: string): Promise<string> {
    const stop = new AbortController();
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    let storageFailure: { error: unknown } | undefined;

    const tools = createPreferenceTools(userId, this.preferences, (error) => {
      storageFailure = { error };
      stop.abort();
    });
    const agent = createAgent({
      model: this.model,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      middleware: [forceAnswerAfterToolRounds(this.options.maxToolRounds), retryModelCalls(this.options, signal)],
    });

    let content: unknown;
    try {
      const result = await agent.invoke(
        { messages: [{ role: 'user', content: message }] },
        { signal, recursionLimit: this.options.recursionLimit },
      );
      content = result.messages.at(-1)?.content;
    } catch (error) {
      if (storageFailure) {
        throw storageFailure.error;
      }
      throw toLlmError(error, timeout.aborted);
    }

    if (storageFailure) {
      throw storageFailure.error;
    }
    const reply = extractText(content);
    if (!reply) {
      throw new LlmError('llm_bad_response');
    }
    return reply;
  }
}

/**
 * Модель может ходить по кругу между оглавлением и подробностями уже после успешного сохранения.
 * Пользователь в этом случае получил бы ошибку, хотя данные записаны. Поэтому последний запрос идёт
 * без инструментов и без истории их вызовов, а результаты передаются как факты: видя эту историю,
 * настоящая модель снова пытается вызвать инструмент, и провайдер отвечает ошибкой 400.
 */
function forceAnswerAfterToolRounds(maxToolRounds: number) {
  return createMiddleware({
    name: 'ForceAnswerAfterToolRounds',
    wrapModelCall: (request, handler) => {
      // Запись является продвижением, а круг состоит из чтений. Если считать и её, потолок обрезает
      // длинное сообщение: часть фактов теряется, а модель отвечает, что всё сохранено.
      const readRounds = request.messages.filter(
        (message) =>
          AIMessage.isInstance(message) &&
          (message.tool_calls?.length ?? 0) > 0 &&
          !message.tool_calls?.some((call) => call.name === SAVE_PREFERENCE_TOOL),
      ).length;
      if (readRounds < maxToolRounds) {
        return handler(request);
      }

      const results = request.messages.filter((message) => ToolMessage.isInstance(message));
      return handler({
        ...request,
        tools: [],
        messages: request.messages.filter((message) => HumanMessage.isInstance(message)),
        systemPrompt: buildFinalAnswerPrompt(results.map((message) => `${message.name}: ${message.text}`)),
      });
    },
  });
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block: { type?: unknown; text?: unknown }) =>
      block.type === 'text' && typeof block.text === 'string' ? block.text : '',
    )
    .join('')
    .trim();
}
