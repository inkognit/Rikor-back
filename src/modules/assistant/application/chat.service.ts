import { Inject, Injectable, Logger } from '@nestjs/common';
import { ASSISTANT_AGENT } from './assistant-agent.port';
import type { AssistantAgent } from './assistant-agent.port';

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(@Inject(ASSISTANT_AGENT) private readonly agent: AssistantAgent) {}

  async chat(userId: string, message: string): Promise<string> {
    const startedAt = Date.now();
    const reply = await this.agent.reply(userId, message);
    // Текст сообщений и предпочтения являются личными данными, поэтому в лог идут только метаданные.
    this.log.log(`chat user_id=${userId} duration_ms=${Date.now() - startedAt}`);
    return reply;
  }
}
