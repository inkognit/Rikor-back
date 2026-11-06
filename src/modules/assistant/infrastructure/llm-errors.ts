import { GraphRecursionError } from '@langchain/langgraph';
import { LlmError } from '../application/errors';

const CONNECTION_ERROR = /connection|fetch failed|econnrefused|econnreset|enotfound|etimedout/i;

/** Агент оборачивает ошибку модели, поэтому статус и настоящая причина лежат глубже по цепочке cause. */
export function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

export function providerStatus(error: unknown): number | undefined {
  for (const item of causeChain(error)) {
    const { status } = item as { status?: unknown };
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

/** Модель сгенерировала некорректный вызов инструмента, и провайдер его отверг. Следующая генерация обычно корректна. */
export function isMalformedToolCall(error: unknown): boolean {
  return causeChain(error).some((item) => (item as { code?: unknown }).code === 'tool_use_failed');
}

export function isConnectionError(chain: Error[]): boolean {
  return CONNECTION_ERROR.test(chain.map((item) => `${item.name} ${item.message}`).join(' '));
}

/** Время из заголовка Retry-After в миллисекундах. */
export function retryAfterMs(error: unknown): number | undefined {
  for (const item of causeChain(error)) {
    const { headers } = item as { headers?: { get?: (name: string) => string | null } };
    const seconds = Number(headers?.get?.('retry-after') ?? Number.NaN);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return undefined;
}

/** Ошибки, не похожие на сбой провайдера, остаются как есть и становятся internal_error: это дефект кода. */
export function toLlmError(error: unknown, timedOut: boolean): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  if (error instanceof GraphRecursionError) {
    return new LlmError('llm_bad_response', { cause: error });
  }

  const chain = causeChain(error);
  const cause = chain.at(-1) ?? error;
  if (timedOut || chain.some((item) => /abort|timeout/i.test(item.name))) {
    return new LlmError('llm_timeout', { cause });
  }

  const status = providerStatus(error);
  if (status === 429) {
    const waitMs = retryAfterMs(error);
    const meta = waitMs === undefined ? undefined : { retry_after_seconds: Math.ceil(waitMs / 1000) };
    return new LlmError('llm_rate_limited', { cause, meta });
  }
  if (status !== undefined || isConnectionError(chain)) {
    return new LlmError('llm_unavailable', { cause });
  }
  return error;
}
