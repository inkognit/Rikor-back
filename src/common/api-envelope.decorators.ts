import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** Описание ошибки для Swagger: контракт конверта с заполненным полем error. */
export class ApiErrorResponse {
  @ApiProperty({ example: false })
  success!: boolean;

  @ApiProperty({ type: 'object', nullable: true, example: null, additionalProperties: false })
  data!: null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    example: null,
    description: 'Подробности ошибки. Для 422 содержит details со списком нарушений.',
  })
  meta!: Record<string, unknown> | null;

  @ApiProperty({ example: 'llm_unavailable', description: 'Стабильный машинный код ошибки в snake_case' })
  error!: string;
}

/** Успешный ответ 200 в конверте { success, data, meta, error }. */
export function ApiEnvelopeOk(model: Type<unknown>, description?: string): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta', 'error'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: getSchemaPath(model) },
          meta: { type: 'object', nullable: true, example: null },
          error: { type: 'string', nullable: true, example: null },
        },
      },
    }),
  );
}

export function ApiErrors(errors: Record<number, string>): MethodDecorator {
  return applyDecorators(
    ...Object.entries(errors).map(([status, description]) =>
      ApiResponse({ status: Number(status), description, type: ApiErrorResponse }),
    ),
  );
}
