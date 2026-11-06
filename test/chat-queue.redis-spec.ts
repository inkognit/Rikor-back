import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from '../src/common/app.error';
import type { AssistantAgent } from '../src/modules/assistant/application/assistant-agent.port';
import { ChatQueueError, LlmError } from '../src/modules/assistant/application/errors';
import { BullmqChatExecutor } from '../src/modules/assistant/infrastructure/bullmq-chat.executor';

const REDIS_URL = 'redis://127.0.0.1:6379';

/** Настоящий Redis из docker compose и настоящие Queue, Worker и QueueEvents. Модель заменена фейковым агентом. */
describe('Очередь сообщений на BullMQ', () => {
  let queueName: string;
  let executor: BullmqChatExecutor;

  const start = async (
    agent: AssistantAgent,
    options: Partial<{ limiterMax: number; limiterDurationMs: number; waitTimeoutMs: number; redisUrl: string }> = {},
  ): Promise<BullmqChatExecutor> => {
    executor = new BullmqChatExecutor(agent, {
      redisUrl: REDIS_URL,
      queueName,
      limiterMax: 100,
      limiterDurationMs: 1000,
      waitTimeoutMs: 10000,
      ...options,
    });
    await executor.onModuleInit();
    return executor;
  };

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    queueName = `test-${randomUUID()}`;
  });

  afterEach(async () => {
    await executor.onModuleDestroy();
    const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(queueName, { connection });
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  });

  it('возвращает ответ агента и передаёт ему user_id и сообщение', async () => {
    const reply = jest.fn(() => Promise.resolve('Ответ'));
    await start({ reply });

    expect(await executor.execute('user-a', 'привет')).toBe('Ответ');
    expect(reply).toHaveBeenCalledWith('user-a', 'привет');
  });

  it('обрабатывает сообщения по одному и в порядке поступления', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    await start({
      reply: async (_userId, message) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(message);
        await sleep(30);
        active -= 1;
        return message;
      },
    });

    const replies = await Promise.all(['1', '2', '3', '4'].map((message) => executor.execute('user-a', message)));

    expect(replies).toEqual(['1', '2', '3', '4']);
    expect(order).toEqual(['1', '2', '3', '4']);
    expect(maxActive).toBe(1);
  });

  it('лимитер переносит лишние сообщения на следующее окно', async () => {
    const startedAt: number[] = [];
    await start(
      {
        reply: (_userId, message) => {
          startedAt.push(Date.now());
          return Promise.resolve(message);
        },
      },
      { limiterMax: 2, limiterDurationMs: 1000 },
    );

    await Promise.all(['1', '2', '3'].map((message) => executor.execute('user-a', message)));

    expect((startedAt[2] as number) - (startedAt[0] as number)).toBeGreaterThanOrEqual(900);
  });

  it('передаёт код и подробности ошибки агента и не повторяет задачу', async () => {
    const reply = jest.fn(() =>
      Promise.reject(new LlmError('llm_rate_limited', { meta: { retry_after_seconds: 462 } })),
    );
    await start({ reply });

    const error = await executor.execute('user-a', 'привет').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'llm_rate_limited', httpStatus: 429, meta: { retry_after_seconds: 462 } });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('неожиданная ошибка не раскрывает подробности и не повторяется', async () => {
    const reply = jest.fn(() => Promise.reject(new Error('disk full: секретный путь')));
    await start({ reply });

    const error = await executor.execute('user-a', 'привет').catch((reason: unknown) => reason);

    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toBe('chat_job_failed');
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('сообщение, не дождавшееся очереди, снимается и не выполняется позже', async () => {
    const processed: string[] = [];
    await start(
      {
        reply: async (_userId, message) => {
          processed.push(message);
          await sleep(1200);
          return message;
        },
      },
      { waitTimeoutMs: 500 },
    );

    const first = executor.execute('user-a', 'первое').catch((reason: unknown) => reason);
    await sleep(100);
    const second = await executor.execute('user-a', 'второе').catch((reason: unknown) => reason);
    expect(second).toBeInstanceOf(ChatQueueError);
    expect(second).toMatchObject({ code: 'chat_queue_timeout', httpStatus: 504 });

    await first;
    await sleep(1500);
    expect(processed).toEqual(['первое']);
  });

  it('данные задачи не попадают в чужую очередь и задача ждётся по своему id', async () => {
    await start({ reply: (userId, message) => Promise.resolve(`${userId}:${message}`) });

    const replies = await Promise.all([executor.execute('user-a', 'x'), executor.execute('user-b', 'y')]);

    expect(replies).toEqual(['user-a:x', 'user-b:y']);
  });

  it('сообщения прошлого запуска не выполняются: ответ на них уже некому получить', async () => {
    const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    const stale = new Queue(queueName, { connection });
    await stale.add('chat', { userId: 'user-a', message: 'старое' });
    await stale.close();
    connection.disconnect();
    const reply = jest.fn((_userId: string, message: string) => Promise.resolve(message));

    await start({ reply });

    expect(await executor.execute('user-a', 'новое')).toBe('новое');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith('user-a', 'новое');
  });

  it('недоступный Redis останавливает старт понятной ошибкой', async () => {
    const broken = new BullmqChatExecutor(
      { reply: () => Promise.resolve('') },
      {
        redisUrl: 'redis://127.0.0.1:1',
        queueName,
        limiterMax: 1,
        limiterDurationMs: 1000,
        waitTimeoutMs: 1000,
      },
    );

    await expect(broken.onModuleInit()).rejects.toThrow('Redis недоступен');
    await start({ reply: () => Promise.resolve('') }); // для afterEach
  });

  it('обрыв Redis во время работы даёт queue_unavailable, а не зависание', async () => {
    await start({ reply: () => Promise.resolve('') });
    const connection = (executor as unknown as { connections: Redis[] }).connections[0] as Redis;
    connection.disconnect();

    const error = await executor.execute('user-a', 'привет').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ChatQueueError);
    expect(error).toMatchObject({ code: 'queue_unavailable', httpStatus: 503 });
  });
});
