import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, describeCause } from './app.error';
import type { ApiEnvelope } from './response.interceptor';

const HTTP_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  422: 'validation_failed',
};

/** Все ошибки уходят в едином конверте со стабильным кодом. Stack trace наружу не попадает. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiEnvelope<null> } {
    if (exception instanceof AppError) {
      this.log.warn(`${exception.code} cause=${describeCause(exception.cause)}`);
      return { status: exception.httpStatus, body: envelope(exception.code, exception.meta) };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: envelope(HTTP_ERROR_CODES[status] ?? `http_${status}`, validationDetails(exception)) };
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.log.error(error.message, error.stack);
    return { status: 500, body: envelope('internal_error', null) };
  }
}

function envelope(code: string, meta: Record<string, unknown> | null): ApiEnvelope<null> {
  return { success: false, data: null, meta, error: code };
}

function validationDetails(exception: HttpException): Record<string, unknown> | null {
  if (exception.getStatus() !== 422) {
    return null;
  }
  const payload = exception.getResponse();
  return typeof payload === 'object' && 'message' in payload ? { details: payload.message } : null;
}
