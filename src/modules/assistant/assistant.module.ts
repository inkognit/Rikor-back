import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ASSISTANT_AGENT } from './application/assistant-agent.port';
import { CHAT_EXECUTOR } from './application/chat-executor.port';
import type { AssistantAgent } from './application/assistant-agent.port';
import { ChatService } from './application/chat.service';
import { PREFERENCES_REPOSITORY } from './application/preferences.port';
import { PreferencesService } from './application/preferences.service';
import { BullmqChatExecutor } from './infrastructure/bullmq-chat.executor';
import { CHAT_MODEL, createChatModel } from './infrastructure/chat-model.factory';
import { JsonFilePreferencesRepository } from './infrastructure/json-file-preferences.repository';
import { LangchainAssistantAgent } from './infrastructure/langchain-assistant.agent';
import { ChatController } from './presentation/chat.controller';

const AGENT_MAX_TOOL_ROUNDS = 5;
const AGENT_RECURSION_LIMIT = 30;
const MODEL_RETRY_BASE_DELAY_MS = 1000;
const CHAT_QUEUE_NAME = 'chat';
const MINUTE_MS = 60_000;

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    PreferencesService,
    {
      provide: PREFERENCES_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new JsonFilePreferencesRepository(config.getOrThrow<string>('DATA_DIR')),
    },
    {
      provide: CHAT_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createChatModel({
          apiKey: config.getOrThrow<string>('LLM_API_KEY'),
          model: config.getOrThrow<string>('LLM_MODEL'),
          baseUrl: config.get<string>('LLM_BASE_URL'),
        }),
    },
    {
      provide: ASSISTANT_AGENT,
      inject: [CHAT_MODEL, PreferencesService, ConfigService],
      useFactory: (model: BaseChatModel, preferences: PreferencesService, config: ConfigService) =>
        new LangchainAssistantAgent(model, preferences, {
          timeoutMs: config.getOrThrow<number>('LLM_TIMEOUT_MS'),
          maxToolRounds: AGENT_MAX_TOOL_ROUNDS,
          recursionLimit: AGENT_RECURSION_LIMIT,
          maxRetries: config.getOrThrow<number>('LLM_MAX_RETRIES'),
          maxRetryWaitMs: config.getOrThrow<number>('LLM_RETRY_MAX_WAIT_MS'),
          baseDelayMs: MODEL_RETRY_BASE_DELAY_MS,
        }),
    },
    {
      provide: CHAT_EXECUTOR,
      inject: [ASSISTANT_AGENT, ConfigService],
      useFactory: (agent: AssistantAgent, config: ConfigService) =>
        new BullmqChatExecutor(agent, {
          redisUrl: config.getOrThrow<string>('REDIS_URL'),
          queueName: CHAT_QUEUE_NAME,
          limiterMax: config.getOrThrow<number>('CHAT_MAX_JOBS_PER_MINUTE'),
          limiterDurationMs: MINUTE_MS,
          waitTimeoutMs: config.getOrThrow<number>('CHAT_WAIT_TIMEOUT_MS'),
        }),
    },
  ],
})
export class AssistantModule {}
