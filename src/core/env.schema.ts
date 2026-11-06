import * as Joi from 'joi';

/**
 * Единственное место, где валидируются переменные окружения.
 * Опечатка в значении роняет приложение при старте, а не проявляется молча в рантайме.
 */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  // Адрес, а не имя: Node и браузер резолвят localhost по-разному.
  HOST: Joi.string().ip().default('127.0.0.1'),
  PORT: Joi.number().port().default(3000),

  DATA_DIR: Joi.string().default('data'),
  LOG_DIR: Joi.string().default('logs'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),

  LLM_API_KEY: Joi.string().required(),
  LLM_MODEL: Joi.string().required(),
  LLM_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }),
  LLM_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000),
  LLM_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(3),
  LLM_RETRY_MAX_WAIT_MS: Joi.number().integer().min(0).default(60000),

  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://127.0.0.1:6379'),
  CHAT_MAX_JOBS_PER_MINUTE: Joi.number().integer().min(1).default(4),
  // Запрос не должен сдаться раньше, чем отработает агент, иначе ответ будет потерян.
  CHAT_WAIT_TIMEOUT_MS: Joi.number().integer().min(Joi.ref('LLM_TIMEOUT_MS')).default(180000),
});
