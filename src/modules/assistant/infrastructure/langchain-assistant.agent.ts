import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { GraphRecursionError } from '@langchain/langgraph';
import { AIMessage, createAgent, createMiddleware, HumanMessage, ToolMessage } from 'langchain';
import type { AssistantAgent } from '../application/assistant-agent.port';
import { LlmError } from '../application/errors';
import type { PreferencesService } from '../application/preferences.service';
import { createPreferenceTools } from './preference.tools';
import { buildFinalAnswerPrompt, SYSTEM_PROMPT } from './system-prompt';

export interface AgentOptions {
  timeoutMs: number;
  /** После стольких обращений к инструментам модель обязана ответить тем, что уже получила. */
  maxToolRounds: number;
  /** Страховка на случай, если модель не подчинится: вызов модели и инструментов считаются отдельными шагами. */
  recursionLimit: number;
}

const CONNECTION_ERROR = /connection|fetch failed|econnrefused|econnreset|enotfound|etimedout/i;

export class LangchainAssistantAgent implements AssistantAgent {
  constructor(
    private readonly model: BaseChatModel,
    private readonly preferences: PreferencesService,
    private readonly options: AgentOptions,
  ) {}

  async reply(userId: string, message: string): Promise<string> {
    const stop = new AbortController();
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let storageFailure: { error: unknown } | undefined;

    const tools = createPreferenceTools(userId, this.preferences, (error) => {
      storageFailure = { error };
      stop.abort();
    });
    const agent = createAgent({
      model: this.model,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      middleware: [forceAnswerAfterToolRounds(this.options.maxToolRounds)],
    });

    let content: unknown;
    try {
      const result = await agent.invoke(
        { messages: [{ role: 'user', content: message }] },
        { signal: AbortSignal.any([stop.signal, timeout]), recursionLimit: this.options.recursionLimit },
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
      const rounds = request.messages.filter(
        (message) => AIMessage.isInstance(message) && (message.tool_calls?.length ?? 0) > 0,
      ).length;
      if (rounds < maxToolRounds) {
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

/** Ошибки, не похожие на сбой провайдера, остаются как есть и становятся internal_error: это дефект кода. */
function toLlmError(error: unknown, timedOut: boolean): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  if (error instanceof GraphRecursionError) {
    return new LlmError('llm_bad_response', { cause: error });
  }

  // Агент оборачивает ошибку модели, поэтому статус и настоящая причина лежат глубже по цепочке cause.
  const chain = causeChain(error);
  const cause = chain.at(-1) ?? error;
  if (timedOut || chain.some((item) => /abort|timeout/i.test(item.name))) {
    return new LlmError('llm_timeout', { cause });
  }
  const status = chain.map((item) => (item as { status?: unknown }).status).find((value) => typeof value === 'number');
  if (status === 429) {
    return new LlmError('llm_rate_limited', { cause });
  }
  if (status !== undefined) {
    return new LlmError('llm_unavailable', { cause });
  }

  const description = chain.map((item) => `${item.name} ${item.message}`).join(' ');
  return CONNECTION_ERROR.test(description) ? new LlmError('llm_unavailable', { cause }) : error;
}

function causeChain(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
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
