export const CHAT_EXECUTOR = Symbol('CHAT_EXECUTOR');

/** Выполняет сообщение и возвращает ответ агента. Как именно: сервису неважно, сейчас через очередь. */
export interface ChatExecutor {
  execute(userId: string, message: string): Promise<string>;
}
