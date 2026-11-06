import { ApiProperty } from '@nestjs/swagger';

export class ChatResponse {
  constructor(v: { reply: string }) {
    this.reply = v.reply;
  }

  @ApiProperty({ example: 'Предлагаю зелёный чай без сахара.', description: 'Текст ответа агента' })
  reply: string;
}
