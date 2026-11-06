import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { AppError, describeCause, ErrorMeta } from '../../../common/app.error';
import type { AssistantAgent } from '../application/assistant-agent.port';
import type { ChatExecutor } from '../application/chat-executor.port';
import { ChatQueueError } from '../application/errors';

export interface BullmqChatExecutorOptions {
  redisUrl: string;
  queueName: string;
  /** Сколько сообщений обрабатывать за окно limiterDurationMs. */
  limiterMax: number;
  limiterDurationMs: number;
  /** Сколько запрос ждёт результат, включая время в очереди. */
  waitTimeoutMs: number;
}

interface ChatJobData {
  userId: string;
  message: string;
}

/** Ошибка передаётся значением: через Redis проходит только текст, а код и подробности нужно сохранить. */
type ChatJobResult =
  { ok: true; reply: string } | { ok: false; code: string; httpStatus: number; meta: ErrorMeta | null };

const CONNECT_AND_CLOSE_TIMEOUT_MS = 5000;
const JOB_RETENTION_SECONDS = 60;
const WAIT_TIMED_OUT = /timed out before finishing/;

/**
 * Сообщения обрабатываются по одному и по порядку, поэтому «запомни» и следующий за ним вопрос не обгоняют
 * друг друга, а лимитер не даёт сжечь лимит токенов провайдера.
 *
 * attempts у задачи намеренно 1: повтор всей задачи заново прогнал бы агента и потратил токены. Повторяется
 * только вызов модели, он безопасен, потому что инструменты в этот момент не выполняются.
 */
export class BullmqChatExecutor implements ChatExecutor, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BullmqChatExecutor.name);
  private readonly connections: Redis[] = [];
  private queue!: Queue<ChatJobData, ChatJobResult>;
  private events!: QueueEvents;
  private worker!: Worker<ChatJobData, ChatJobResult>;

  constructor(
    private readonly agent: AssistantAgent,
    private readonly options: BullmqChatExecutorOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    const { queueName, limiterMax, limiterDurationMs } = this.options;

    // Очередь не копит команды при обрыве: запрос сразу получает queue_unavailable и не висит.
    const queueConnection = this.connect({ maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.queue = new Queue(queueName, { connection: queueConnection });
    this.queue.on('error', (error) => this.log.error(`queue ${describeCause(error)}`));

    // Воркер создаётся после проверки Redis и очистки очереди: иначе он успел бы взять старую задачу, а при
    // недоступном Redis его собственное соединение бесконечно переподключалось бы.
    try {
      await withTimeout(this.queue.waitUntilReady(), CONNECT_AND_CLOSE_TIMEOUT_MS);
      // HTTP-запросы этих сообщений оборвались вместе с прошлым запуском, ответ на них уже некому получить.
      await this.queue.drain();
    } catch (error) {
      await this.onModuleDestroy();
      throw new Error('Redis недоступен: проверьте REDIS_URL и выполните docker compose up -d --wait', {
        cause: error,
      });
    }

    this.events = new QueueEvents(queueName, { connection: this.connect({ maxRetriesPerRequest: null }) });
    this.worker = new Worker(queueName, (job) => this.process(job.data), {
      connection: this.connect({ maxRetriesPerRequest: null }),
      concurrency: 1,
      // Прерванная задача не запускается заново: ответ на неё уже некому получить.
      maxStalledCount: 0,
      limiter: { max: limiterMax, duration: limiterDurationMs },
    });
    this.events.on('error', (error) => this.log.error(`events ${describeCause(error)}`));
    this.worker.on('error', (error) => this.log.error(`worker ${describeCause(error)}`));
    this.worker.on('failed', (job, error) => this.log.error(`job_failed id=${job?.id} ${error.message}`, error.stack));

    await withTimeout(
      Promise.all([this.events.waitUntilReady(), this.worker.waitUntilReady()]),
      CONNECT_AND_CLOSE_TIMEOUT_MS,
    );
  }

  /** Закрытие ограничено по времени: при недоступном Redis оно иначе не завершается, и сервис не останавливается. */
  async onModuleDestroy(): Promise<void> {
    const closing = Promise.allSettled([this.worker?.close(), this.events?.close(), this.queue?.close()]);
    await withTimeout(closing, CONNECT_AND_CLOSE_TIMEOUT_MS).catch(() => undefined);
    for (const connection of this.connections) {
      connection.disconnect();
    }
  }

  async execute(userId: string, message: string): Promise<string> {
    const job = await this.queue
      .add(
        'chat',
        { userId, message },
        {
          attempts: 1,
          // Короткий срок вместо немедленного удаления: иначе быстрая задача пропала бы раньше, чем её начнут ждать.
          removeOnComplete: { age: JOB_RETENTION_SECONDS },
          removeOnFail: { age: JOB_RETENTION_SECONDS },
        },
      )
      .catch((cause: unknown) => {
        throw new ChatQueueError('queue_unavailable', { cause });
      });

    let result: ChatJobResult;
    try {
      result = await job.waitUntilFinished(this.events, this.options.waitTimeoutMs);
    } catch (error) {
      if (error instanceof Error && WAIT_TIMED_OUT.test(error.message)) {
        // Клиент уже получит ошибку, поэтому задача из очереди не должна выполниться позже. Активную задачу
        // удалить нельзя, она завершится сама в пределах LLM_TIMEOUT_MS.
        await job.remove().catch(() => undefined);
        throw new ChatQueueError('chat_queue_timeout', { cause: error });
      }
      throw new Error('chat_job_failed');
    }

    if (!result.ok) {
      throw new AppError(result.code, result.httpStatus, { meta: result.meta ?? undefined });
    }
    return result.reply;
  }

  private async process({ userId, message }: ChatJobData): Promise<ChatJobResult> {
    try {
      return { ok: true, reply: await this.agent.reply(userId, message) };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      this.log.warn(`${error.code} user_id=${userId} cause=${describeCause(error.cause)}`);
      return { ok: false, code: error.code, httpStatus: error.httpStatus, meta: error.meta };
    }
  }

  private connect(options: { maxRetriesPerRequest: number | null; enableOfflineQueue?: boolean }): Redis {
    const connection = new Redis(this.options.redisUrl, options);
    connection.on('error', (error) => this.log.warn(`redis ${describeCause(error)}`));
    this.connections.push(connection);
    return connection;
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis_timeout')), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
