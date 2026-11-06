import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LlmError } from '../src/modules/assistant/application/errors';
import { PreferencesService } from '../src/modules/assistant/application/preferences.service';
import { createChatModel } from '../src/modules/assistant/infrastructure/chat-model.factory';
import { LangchainAssistantAgent } from '../src/modules/assistant/infrastructure/langchain-assistant.agent';
import { InMemoryPreferencesRepository } from './support/in-memory-preferences.repository';

type Handler = (body: CompletionRequest, res: ServerResponse) => void;

interface CompletionRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[];
}

const completion = (message: Record<string, unknown>, finish_reason = 'stop') => ({
  id: `chatcmpl-${randomUUID()}`,
  object: 'chat.completion',
  created: 0,
  model: 'test-model',
  choices: [{ index: 0, finish_reason, message: { role: 'assistant', ...message } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const toolCall = (name: string, args: Record<string, unknown>) =>
  completion(
    {
      content: null,
      tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
    'tool_calls',
  );

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Настоящий адаптер ChatOpenAI против локального HTTP-сервера: проверяет формат обмена и настоящие ошибки SDK. */
describe('Адаптер LLM по протоколу OpenAI', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let requests: { headers: IncomingMessage['headers']; body: CompletionRequest }[];
  let repository: InMemoryPreferencesRepository;

  const createAgent = (url = baseUrl, timeoutMs = 5000, retry = { maxRetries: 0, maxRetryWaitMs: 2000 }) =>
    new LangchainAssistantAgent(
      createChatModel({ apiKey: 'secret-key', model: 'test-model', baseUrl: url }),
      new PreferencesService(repository),
      { timeoutMs, maxToolRounds: 2, recursionLimit: 8, baseDelayMs: 10, ...retry },
    );
  /** Ответ о лимите в формате Groq: с Retry-After и словом billing, из-за которого LangChain не повторяет сам. */
  const rateLimit = (res: ServerResponse, retryAfter: number): void => {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
    res.end(JSON.stringify({ error: { message: 'Rate limit reached, see billing', code: 'rate_limit_exceeded' } }));
  };
  const failureCode = async (agent: LangchainAssistantAgent): Promise<string> => {
    const error: unknown = await agent.reply('user-a', 'привет').then(
      () => new Error('Ожидалась ошибка'),
      (reason: unknown) => reason,
    );
    if (!(error instanceof LlmError)) {
      throw error;
    }
    return error.code;
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as CompletionRequest;
        requests.push({ headers: req.headers, body });
        handler(body, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    repository = new InMemoryPreferencesRepository();
  });

  it('выполняет вызов инструмента моделью и подставляет user_id из запроса', async () => {
    handler = (_body, res) =>
      sendJson(
        res,
        200,
        requests.length === 1
          ? toolCall('save_preference', {
              preferences: [{ category: 'напитки', key: 'напиток', value: 'чай' }],
              user_id: 'victim',
            })
          : completion({ content: 'Запомнил' }),
      );

    const reply = await createAgent().reply('user-a', 'Я предпочитаю чай');

    expect(reply).toBe('Запомнил');
    expect(await repository.load('user-a')).toEqual({ напитки: { напиток: 'чай' } });
    expect(await repository.load('victim')).toEqual({});

    const first = requests[0];
    expect(first?.headers.authorization).toBe('Bearer secret-key');
    expect(first?.body.model).toBe('test-model');
    expect(first?.body.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(first?.body.tools?.map((tool) => tool.function.name).sort()).toEqual(['get_preferences', 'save_preference']);
    for (const tool of first?.body.tools ?? []) {
      expect(tool.function.parameters.properties).not.toHaveProperty('user_id');
    }
    expect(requests[1]?.body.messages.at(-1)?.role).toBe('tool');
  });

  it('лимит провайдера даёт llm_rate_limited', async () => {
    handler = (_body, res) => sendJson(res, 429, { error: { message: 'rate limit' } });
    expect(await failureCode(createAgent())).toBe('llm_rate_limited');
  });

  it.each([401, 404, 500, 503])('статус провайдера %i даёт llm_unavailable', async (status) => {
    handler = (_body, res) => sendJson(res, status, { error: { message: 'provider failure' } });
    expect(await failureCode(createAgent())).toBe('llm_unavailable');
  });

  it('ждёт Retry-After и повторяет только вызов модели', async () => {
    handler = (_body, res) =>
      requests.length === 1 ? rateLimit(res, 1) : sendJson(res, 200, completion({ content: 'Готово' }));
    const startedAt = Date.now();

    const reply = await createAgent(baseUrl, 5000, { maxRetries: 2, maxRetryWaitMs: 2000 }).reply('user-a', 'привет');

    expect(reply).toBe('Готово');
    expect(requests).toHaveLength(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  it('не ждёт дольше порога и сообщает, когда повторить', async () => {
    handler = (_body, res) => rateLimit(res, 462);

    const error: unknown = await createAgent(baseUrl, 5000, { maxRetries: 3, maxRetryWaitMs: 2000 })
      .reply('user-a', 'привет')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'llm_rate_limited', meta: { retry_after_seconds: 462 } });
    expect(requests).toHaveLength(1);
  });

  it('повторяет сбой провайдера 5xx и не повторяет отказ 4xx', async () => {
    handler = (_body, res) =>
      requests.length === 1
        ? sendJson(res, 500, { error: { message: 'boom' } })
        : sendJson(res, 200, completion({ content: 'Готово' }));
    const retry = { maxRetries: 2, maxRetryWaitMs: 2000 };
    expect(await createAgent(baseUrl, 5000, retry).reply('user-a', 'привет')).toBe('Готово');
    expect(requests).toHaveLength(2);

    requests = [];
    handler = (_body, res) => sendJson(res, 401, { error: { message: 'bad key' } });
    expect(await failureCode(createAgent(baseUrl, 5000, retry))).toBe('llm_unavailable');
    expect(requests).toHaveLength(1);
  });

  it('повторяет вызов модели, если провайдер отверг некорректный вызов инструмента', async () => {
    handler = (_body, res) =>
      requests.length === 1
        ? sendJson(res, 400, { error: { message: 'Failed to call a function', code: 'tool_use_failed' } })
        : sendJson(res, 200, completion({ content: 'Готово' }));

    const reply = await createAgent(baseUrl, 5000, { maxRetries: 1, maxRetryWaitMs: 2000 }).reply('user-a', 'привет');

    expect(reply).toBe('Готово');
    expect(requests).toHaveLength(2);
  });

  it('повтор вызова модели не повторяет сохранение', async () => {
    handler = (_body, res) => {
      if (requests.length === 1) {
        sendJson(
          res,
          200,
          toolCall('save_preference', { preferences: [{ category: 'напитки', key: 'напиток', value: 'чай' }] }),
        );
      } else if (requests.length === 2) {
        rateLimit(res, 0);
      } else {
        sendJson(res, 200, completion({ content: 'Запомнил' }));
      }
    };
    const save = jest.spyOn(repository, 'upsert');

    await createAgent(baseUrl, 5000, { maxRetries: 2, maxRetryWaitMs: 2000 }).reply('user-a', 'Я предпочитаю чай');

    expect(requests).toHaveLength(3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('недоступный провайдер даёт llm_unavailable', async () => {
    expect(await failureCode(createAgent('http://127.0.0.1:9/v1'))).toBe('llm_unavailable');
  });

  it('зависший провайдер даёт llm_timeout', async () => {
    handler = () => undefined;
    expect(await failureCode(createAgent(baseUrl, 200))).toBe('llm_timeout');
  });

  it('пустой ответ модели даёт llm_bad_response', async () => {
    handler = (_body, res) => sendJson(res, 200, completion({ content: '' }));
    expect(await failureCode(createAgent())).toBe('llm_bad_response');
  });

  it('зациклившаяся модель получает запрос без инструментов и отвечает пользователю', async () => {
    handler = (body, res) =>
      sendJson(
        res,
        200,
        body.tools?.length ? toolCall('get_preferences', {}) : completion({ content: 'Итоговый ответ' }),
      );

    const reply = await createAgent().reply('user-a', 'Какой напиток?');

    expect(reply).toBe('Итоговый ответ');
    expect(requests.map((request) => request.body.tools?.length ?? 0)).toEqual([2, 2, 0]);
    const final = requests.at(-1)?.body;
    expect(final?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(final?.messages[0]?.content)).toContain('categories');
    expect(JSON.stringify(final?.messages[0]?.content)).not.toContain('вызови');
  });

  it('модель, вызывающая инструменты и без их наличия, останавливается и даёт llm_bad_response', async () => {
    handler = (_body, res) => sendJson(res, 200, toolCall('get_preferences', {}));
    expect(await failureCode(createAgent())).toBe('llm_bad_response');
    expect(requests.length).toBeLessThanOrEqual(8);
  });
});
