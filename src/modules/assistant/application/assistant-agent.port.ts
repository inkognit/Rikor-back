export const ASSISTANT_AGENT = Symbol('ASSISTANT_AGENT');

export interface AssistantAgent {
  reply(userId: string, message: string): Promise<string>;
}
