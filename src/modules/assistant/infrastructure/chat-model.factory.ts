import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

export const CHAT_MODEL = Symbol('CHAT_MODEL');

export interface ChatModelOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxRetries: number;
}

/** Подходит любому OpenAI-совместимому провайдеру: провайдер определяется базовым адресом и ключом. */
export function createChatModel(options: ChatModelOptions): BaseChatModel {
  return new ChatOpenAI({
    apiKey: options.apiKey,
    model: options.model,
    temperature: 0, // одинаковые формулировки должны давать одинаковые category и key
    maxRetries: options.maxRetries,
    configuration: { baseURL: options.baseUrl },
  });
}
