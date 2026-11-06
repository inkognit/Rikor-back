import { ApiProperty } from '@nestjs/swagger';

export class HealthResponse {
  constructor(v: { status: 'ok' }) {
    this.status = v.status;
  }

  @ApiProperty({ example: 'ok', description: 'Сервис запущен и принимает запросы' })
  status: 'ok';
}
