import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp, configureSwagger } from '../../src/app.setup';
import {
  PREFERENCES_REPOSITORY,
  PreferencesRepository,
} from '../../src/modules/assistant/application/preferences.port';
import { CHAT_MODEL } from '../../src/modules/assistant/infrastructure/chat-model.factory';
import type { ScriptedChatModel } from './scripted-chat-model';

/** Собирает приложение той же конфигурацией, что и main.ts. Новый вызов эквивалентен перезапуску сервиса. */
export async function createTestApp(
  model: ScriptedChatModel,
  repository: PreferencesRepository,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAT_MODEL)
    .useValue(model)
    .overrideProvider(PREFERENCES_REPOSITORY)
    .useValue(repository)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  configureSwagger(app);
  await app.init();
  return app;
}
