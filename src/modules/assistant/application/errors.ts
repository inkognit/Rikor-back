import { AppError, ErrorMeta } from '../../../common/app.error';

export type LlmErrorCode = 'llm_unavailable' | 'llm_rate_limited' | 'llm_timeout' | 'llm_bad_response';

const LLM_HTTP_STATUS: Record<LlmErrorCode, number> = {
  llm_rate_limited: 429,
  llm_bad_response: 502,
  llm_unavailable: 503,
  llm_timeout: 504,
};

export class LlmError extends AppError {
  constructor(code: LlmErrorCode, options?: ErrorOptions & { meta?: ErrorMeta }) {
    super(code, LLM_HTTP_STATUS[code], options);
  }
}

export type ChatQueueErrorCode = 'queue_unavailable' | 'chat_queue_timeout';

const QUEUE_HTTP_STATUS: Record<ChatQueueErrorCode, number> = {
  queue_unavailable: 503,
  chat_queue_timeout: 504,
};

export class ChatQueueError extends AppError {
  constructor(code: ChatQueueErrorCode, options?: ErrorOptions) {
    super(code, QUEUE_HTTP_STATUS[code], options);
  }
}
