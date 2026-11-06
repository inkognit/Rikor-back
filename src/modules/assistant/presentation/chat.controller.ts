import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeOk, ApiErrors } from '../../../common/api-envelope.decorators';
import { ChatService } from '../application/chat.service';
import { ChatDto } from './chat.dto';
import { ChatResponse } from './chat.response.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Отправить сообщение агенту, который помнит предпочтения пользователя' })
  @ApiEnvelopeOk(ChatResponse, 'Ответ агента')
  @ApiErrors({
    400: 'bad_request: тело запроса не является корректным JSON',
    422: 'validation_failed: неверные user_id или message',
    429: 'llm_rate_limited: исчерпан лимит провайдера LLM, запрос можно повторить позже',
    500: 'internal_error: внутренняя ошибка, в том числе сбой хранилища',
    502: 'llm_bad_response: модель вернула пустой ответ или зациклилась на инструментах',
    503: 'llm_unavailable: провайдер LLM недоступен или отклонил запрос',
    504: 'llm_timeout: модель не ответила вовремя',
  })
  async chat(@Body() dto: ChatDto): Promise<ChatResponse> {
    return new ChatResponse({ reply: await this.chatService.chat(dto.user_id, dto.message) });
  }
}
