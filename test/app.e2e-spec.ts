import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { InMemoryPreferencesRepository } from './support/in-memory-preferences.repository';
import { ScriptedChatModel } from './support/scripted-chat-model';
import { createTestApp } from './support/test-app';

describe('Каркас приложения', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp(new ScriptedChatModel(), new InMemoryPreferencesRepository());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health отвечает в едином конверте', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' }, meta: null, error: null });
  });

  it('неизвестный маршрут отдаёт машинный код', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toEqual({ success: false, data: null, meta: null, error: 'not_found' });
  });

  it('Swagger описывает /chat, его схемы и коды ошибок', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const doc = res.body as {
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
      components: { schemas: Record<string, { required?: string[] }> };
    };

    expect(doc.paths).toHaveProperty('/health');
    expect(Object.keys(doc.paths['/chat']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '422', '429', '500', '502', '503', '504']),
    );
    expect(doc.components.schemas.ChatDto?.required).toEqual(expect.arrayContaining(['user_id', 'message']));
    expect(doc.components.schemas).toHaveProperty('ChatResponse');
  });
});
