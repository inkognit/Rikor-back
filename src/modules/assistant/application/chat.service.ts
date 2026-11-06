import { Inject, Injectable, Logger } from '@nestjs/common';
import { CHAT_EXECUTOR } from './chat-executor.port';
import type { ChatExecutor } from './chat-executor.port';

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(@Inject(CHAT_EXECUTOR) private readonly executor: ChatExecutor) {}

  async chat(userId: string, message: string): Promise<string> {
    const startedAt = Date.now();
    const reply = await this.executor.execute(userId, message);
    // Текст сообщений и предпочтения являются личными данными, поэтому в лог идут только метаданные.
    this.log.log(`chat user_id=${userId} duration_ms=${Date.now() - startedAt}`);
    return reply;
  }
}
