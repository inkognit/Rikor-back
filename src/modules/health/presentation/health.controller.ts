import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeOk } from '../../../common/api-envelope.decorators';
import { HealthResponse } from './health.response.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Проверка, что сервис запущен' })
  @ApiEnvelopeOk(HealthResponse)
  check(): HealthResponse {
    return new HealthResponse({ status: 'ok' });
  }
}
