import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Окружение тестов задаётся здесь и не зависит от .env разработчика: process.env важнее файла .env,
 * поэтому настоящий ключ не попадёт в тест, а адрес ниже никуда не ведёт.
 */
const root = mkdtempSync(join(tmpdir(), 'rikor-e2e-'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = join(root, 'data');
process.env.LOG_DIR = join(root, 'logs');
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.LLM_BASE_URL = 'http://127.0.0.1:9/v1';
