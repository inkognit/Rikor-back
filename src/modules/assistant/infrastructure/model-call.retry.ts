import { Logger } from '@nestjs/common';
import { createMiddleware } from 'langchain';
import { setTimeout as sleep } from 'node:timers/promises';
import { causeChain, isConnectionError, isMalformedToolCall, providerStatus, retryAfterMs } from './llm-errors';

export interface ModelCallRetryOptions {
  maxRetries: number;
  /** Если провайдер просит ждать дольше, ответ уходит сразу: держать HTTP-запрос столько нет смысла. */
  maxRetryWaitMs: number;
  /** Пауза перед первым повтором, если провайдер не назвал время. Дальше удваивается. */
  baseDelayMs: number;
}

const log = new Logger('ModelCallRetry');

/**
 * Встроенный повтор LangChain здесь не работает: он считает 429 исчерпанной квотой, если в тексте ошибки есть
 * слово billing, а оно есть в любом ответе Groq о лимите. Поэтому повтор свой и учитывает Retry-After.
 *
 * Повторяется только вызов модели: инструменты в этот момент не выполняются, поэтому записи не задваиваются.
 */
export function retryModelCalls(options: ModelCallRetryOptions, signal: AbortSignal) {
  return createMiddleware({
    name: 'RetryModelCalls',
    wrapModelCall: async (request, handler) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await handler(request);
        } catch (error) {
          const delayMs = signal.aborted ? null : retryDelayMs(error, attempt, options);
          if (delayMs === null) {
            throw error;
          }
          log.warn(`model_call_retry attempt=${attempt + 1} delay_ms=${delayMs} status=${providerStatus(error)}`);
          await sleep(delayMs, undefined, { signal });
        }
      }
    },
  });
}

function retryDelayMs(error: unknown, attempt: number, options: ModelCallRetryOptions): number | null {
  if (attempt >= options.maxRetries) {
    return null;
  }
  const status = providerStatus(error);
  const retryable =
    status === undefined
      ? isConnectionError(causeChain(error))
      : status === 429 || status >= 500 || isMalformedToolCall(error);
  if (!retryable) {
    return null;
  }

  const requested = retryAfterMs(error);
  if (requested !== undefined && requested > options.maxRetryWaitMs) {
    return null;
  }
  return requested ?? options.baseDelayMs * 2 ** attempt;
}
