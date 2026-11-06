import { AppError } from '../../../common/app.error';

export type LlmErrorCode = 'llm_unavailable' | 'llm_rate_limited' | 'llm_timeout' | 'llm_bad_response';

const HTTP_STATUS: Record<LlmErrorCode, number> = {
  llm_rate_limited: 429,
  llm_bad_response: 502,
  llm_unavailable: 503,
  llm_timeout: 504,
};

export class LlmError extends AppError {
  constructor(code: LlmErrorCode, options?: ErrorOptions) {
    super(code, HTTP_STATUS[code], options);
  }
}
