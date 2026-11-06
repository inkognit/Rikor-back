import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { randomUUID } from 'node:crypto';

export type ScriptStep = (messages: BaseMessage[]) => AIMessage;

/**
 * Модель по сценарию: вместо сети выполняет заранее заданные шаги. Настоящими остаются агент
 * LangChain, инструменты и хранилище, поэтому тест проверяет весь путь данных, кроме решений LLM.
 */
export class ScriptedChatModel extends BaseChatModel {
  readonly boundTools: unknown[][] = [];
  readonly receivedMessages: BaseMessage[][] = [];
  private readonly steps: ScriptStep[] = [];

  constructor() {
    super({});
  }

  enqueue(...steps: ScriptStep[]): void {
    this.steps.push(...steps);
  }

  get pendingSteps(): number {
    return this.steps.length;
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(tools: unknown[]): this {
    this.boundTools.push(tools);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- контракт BaseChatModel требует Promise
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.receivedMessages.push(messages);
    const step = this.steps.shift();
    if (!step) {
      throw new Error('Сценарий модели закончился раньше, чем агент завершил работу');
    }
    const message = step(messages);
    return { generations: [{ text: message.text, message }] };
  }
}

export function callTool(name: string, args: Record<string, unknown>): ScriptStep {
  return () => new AIMessage({ content: '', tool_calls: [{ id: randomUUID(), name, args, type: 'tool_call' }] });
}

export function say(text: string): ScriptStep {
  return () => new AIMessage(text);
}

/** Ответ из результата последнего инструмента: доказывает, что данные памяти дошли до модели. */
export function answerFromLastTool(messages: BaseMessage[]): AIMessage {
  return new AIMessage(`Ответ по памяти: ${lastToolContent(messages)}`);
}

export function lastToolContent(messages: BaseMessage[]): string {
  const toolMessage = messages.filter((message) => ToolMessage.isInstance(message)).at(-1);
  if (!toolMessage) {
    throw new Error('Модель не получила результат инструмента');
  }
  return toolMessage.text;
}

export function failWith(error: Error): ScriptStep {
  return () => {
    throw error;
  };
}
