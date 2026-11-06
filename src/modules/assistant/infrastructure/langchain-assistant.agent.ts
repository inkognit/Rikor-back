import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { GraphRecursionError } from '@langchain/langgraph';
import { createAgent } from 'langchain';
import type { AssistantAgent } from '../application/assistant-agent.port';
import { LlmError } from '../application/errors';
import type { PreferencesService } from '../application/preferences.service';
import { createPreferenceTools } from './preference.tools';
import { SYSTEM_PROMPT } from './system-prompt';

export interface AgentOptions {
  timeoutMs: number;
  /** Потолок шагов графа: вызов модели и вызов инструментов считаются отдельными шагами. */
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
    const agent = createAgent({ model: this.model, tools, systemPrompt: SYSTEM_PROMPT });

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

/** Ошибки, не похожие на сбой провайдера, остаются как есть и становятся internal_error: это дефект кода. */
function toLlmError(error: unknown, timedOut: boolean): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const options = { cause: error };

  if (timedOut || /abort|timeout/i.test(error.name)) {
    return new LlmError('llm_timeout', options);
  }
  if (error instanceof GraphRecursionError) {
    return new LlmError('llm_bad_response', options);
  }
  const { status } = error as { status?: unknown };
  if (status === 429) {
    return new LlmError('llm_rate_limited', options);
  }
  if (typeof status === 'number') {
    return new LlmError('llm_unavailable', options);
  }

  const rootCause = error.cause instanceof Error ? error.cause.message : '';
  const description = `${error.name} ${error.message} ${rootCause}`;
  return CONNECTION_ERROR.test(description) ? new LlmError('llm_unavailable', options) : error;
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
