import { LoggerService, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import winston from 'winston';

const { combine, colorize, errors, json, printf, timestamp } = winston.format;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

const consoleFormat = printf(({ level, message, timestamp: time, context }) => {
  const scope = typeof context === 'string' ? ` [${context}]` : '';
  return `${String(time)} ${level}:${scope} ${String(message)}`;
});

/** Адаптер Winston для Nest: консоль и файлы с ротацией, файлы переживают перезапуск сервиса. */
export class WinstonLogger implements LoggerService, OnModuleDestroy {
  private readonly logger: winston.Logger;

  constructor(options: { directory: string; level: string }) {
    this.logger = winston.createLogger({
      level: options.level,
      format: combine(errors({ stack: true }), timestamp(), json()),
      transports: [
        new winston.transports.Console({
          format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), consoleFormat),
        }),
        new winston.transports.File({
          filename: join(options.directory, 'app.log'),
          maxsize: MAX_FILE_SIZE_BYTES,
          maxFiles: MAX_FILES,
        }),
        new winston.transports.File({
          filename: join(options.directory, 'error.log'),
          level: 'error',
          maxsize: MAX_FILE_SIZE_BYTES,
          maxFiles: MAX_FILES,
        }),
      ],
    });
  }

  log(message: unknown, context?: string): void {
    this.logger.info(String(message), { context });
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error(String(message), { context, stack });
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(String(message), { context });
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(String(message), { context });
  }

  verbose(message: unknown, context?: string): void {
    this.logger.verbose(String(message), { context });
  }

  onModuleDestroy(): void {
    this.logger.close();
  }
}
