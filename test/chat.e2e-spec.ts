import { INestApplication } from '@nestjs/common';
import { ToolMessage } from '@langchain/core/messages';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { PreferencesRepository } from '../src/modules/assistant/application/preferences.port';
import { JsonFilePreferencesRepository } from '../src/modules/assistant/infrastructure/json-file-preferences.repository';
import { answerFromLastTool, callTool, failWith, say, ScriptedChatModel } from './support/scripted-chat-model';
import { createTestApp } from './support/test-app';

const replyOf = (res: request.Response): string => (res.body as { data: { reply: string } }).data.reply;

const SAVE = 'save_preference';
const GET = 'get_preferences';
const DRINK = { category: 'Напитки', key: 'предпочитаемый напиток' };

describe('POST /chat', () => {
  let dataDir: string;
  let model: ScriptedChatModel;
  let app: INestApplication<App>;

  const startApp = async (repository?: PreferencesRepository): Promise<void> => {
    app = await createTestApp(model, repository ?? new JsonFilePreferencesRepository(dataDir));
  };
  const chat = (user_id: string, message: string) =>
    request(app.getHttpServer()).post('/chat').send({ user_id, message });
  const savedFiles = () => readdirSync(join(dataDir, 'users'));
  const readSaved = (file: string) =>
    JSON.parse(readFileSync(join(dataDir, 'users', file), 'utf8')) as {
      userId: string;
      preferences: Record<string, Record<string, string>>;
    };

  /** Шаги модели на вопрос о напитке: оглавление, затем значения темы. */
  const scriptDrinkQuestion = (): void => {
    model.enqueue(callTool(GET, {}), callTool(GET, { category: DRINK.category }), answerFromLastTool);
  };
  const scriptSaveDrink = (value: string): void => {
    model.enqueue(callTool(GET, {}), callTool(SAVE, { ...DRINK, value }), say('Запомнил'));
  };

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'rikor-chat-'));
    model = new ScriptedChatModel();
    await startApp();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('проходит сценарий из ТЗ: сохранение, изоляция, обновление, перезапуск', async () => {
    scriptSaveDrink('чай');
    const saved = await chat('user-a', 'Я предпочитаю чай').expect(200);
    expect(saved.body).toEqual({ success: true, data: { reply: 'Запомнил' }, meta: null, error: null });

    scriptDrinkQuestion();
    const answerA = await chat('user-a', 'Какой напиток мне предложишь?').expect(200);
    expect(replyOf(answerA)).toContain('чай');

    // Пользователь Б: оглавление пустое, значит модель не получила чужих данных.
    model.enqueue(callTool(GET, {}), answerFromLastTool);
    const answerB = await chat('user-b', 'Какой напиток мне предложишь?').expect(200);
    expect(replyOf(answerB)).toContain('"categories":[]');
    expect(replyOf(answerB)).not.toContain('чай');

    scriptSaveDrink('кофе');
    await chat('user-a', 'Теперь я предпочитаю кофе').expect(200);

    await app.close();
    await startApp();

    scriptDrinkQuestion();
    const afterRestart = await chat('user-a', 'Какой напиток мне предложишь?').expect(200);
    expect(replyOf(afterRestart)).toContain('кофе');
    expect(replyOf(afterRestart)).not.toContain('чай');
    expect(model.pendingSteps).toBe(0);
  });

  it('изменение заменяет значение, а не добавляет вторую запись', async () => {
    scriptSaveDrink('чай');
    await chat('user-a', 'Я предпочитаю чай').expect(200);
    scriptSaveDrink('кофе');
    await chat('user-a', 'Теперь кофе').expect(200);

    const [file] = savedFiles();
    expect(savedFiles()).toHaveLength(1);
    expect(readSaved(file as string).preferences).toEqual({ напитки: { 'предпочитаемый напиток': 'кофе' } });
  });

  it('повторное сохранение того же значения не создаёт дубликат', async () => {
    scriptSaveDrink('чай');
    await chat('user-a', 'Я предпочитаю чай').expect(200);

    model.enqueue(
      callTool(SAVE, { category: ' НАПИТКИ ', key: 'Предпочитаемый  напиток', value: 'чай' }),
      answerFromLastTool,
    );
    const repeated = await chat('user-a', 'Я же говорил, что предпочитаю чай').expect(200);

    expect(replyOf(repeated)).toContain('"outcome":"unchanged"');
    expect(readSaved(savedFiles()[0] as string).preferences).toEqual({ напитки: { 'предпочитаемый напиток': 'чай' } });
  });

  it('оглавление не раскрывает значения, а подробности возвращает только запрос темы', async () => {
    scriptSaveDrink('чай');
    await chat('user-a', 'Я предпочитаю чай').expect(200);

    model.enqueue(callTool(GET, {}), answerFromLastTool);
    const index = await chat('user-a', 'Что ты обо мне знаешь?').expect(200);

    expect(replyOf(index)).toContain('напитки');
    expect(replyOf(index)).not.toContain('чай');
  });

  it('незнакомая тема возвращает признак отсутствия и список известных тем', async () => {
    scriptSaveDrink('чай');
    await chat('user-a', 'Я предпочитаю чай').expect(200);

    model.enqueue(callTool(GET, { category: 'машины' }), answerFromLastTool);
    const res = await chat('user-a', 'Какие машины мне нравятся?').expect(200);

    expect(replyOf(res)).toContain('"found":false');
    expect(replyOf(res)).toContain('"knownCategories":["напитки"]');
  });

  it('user_id в аргументах инструмента не влияет на то, чья память изменится', async () => {
    model.enqueue(callTool(SAVE, { ...DRINK, value: 'чай', user_id: 'victim' }), say('Запомнил'));
    await chat('attacker', 'Я предпочитаю чай').expect(200);

    expect(savedFiles()).toHaveLength(1);
    expect(readSaved(savedFiles()[0] as string).userId).toBe('attacker');

    model.enqueue(callTool(GET, { user_id: 'attacker' }), answerFromLastTool);
    const victim = await chat('victim', 'Что ты обо мне знаешь?').expect(200);
    expect(replyOf(victim)).toContain('"categories":[]');
  });

  it('модели доступны ровно два инструмента, и ни один не принимает user_id', async () => {
    model.enqueue(say('Привет'));
    await chat('user-a', 'Привет').expect(200);

    const tools = model.boundTools[0] as { name: string; schema: { shape: Record<string, unknown> } }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([GET, SAVE]);
    for (const tool of tools) {
      expect(Object.keys(tool.schema.shape)).not.toContain('user_id');
    }
  });

  it('передаёт модели системный промпт и сообщение пользователя, инструменты вызывает только модель', async () => {
    model.enqueue(say('Столица Франции: Париж'));
    const res = await chat('user-a', 'Я предпочитаю чай').expect(200);

    const types = (model.receivedMessages[0] ?? []).map((message) => message.getType());
    expect(types).toEqual(['system', 'human']);
    expect(replyOf(res)).toBe('Столица Франции: Париж');
    expect(() => savedFiles()).toThrow(); // модель не вызвала инструмент, значит память пуста
  });

  it('неверные аргументы инструмента возвращаются модели и ничего не сохраняют', async () => {
    model.enqueue(callTool(SAVE, { ...DRINK, value: '   ' }), (messages) => {
      const toolMessage = messages.at(-1) as ToolMessage;
      expect(toolMessage.status).toBe('error');
      return say('Не удалось сохранить')(messages);
    });

    await chat('user-a', 'Я предпочитаю ...').expect(200);

    expect(() => savedFiles()).toThrow();
  });

  it.each([
    ['без user_id', { message: 'привет' }],
    ['без message', { user_id: 'user-a' }],
    ['пустой user_id', { user_id: '', message: 'привет' }],
    ['user_id с обходом пути', { user_id: '../../etc/passwd', message: 'привет' }],
    ['user_id не строка', { user_id: 42, message: 'привет' }],
    ['слишком длинный user_id', { user_id: 'a'.repeat(129), message: 'привет' }],
    ['message из пробелов', { user_id: 'user-a', message: '   ' }],
    ['слишком длинный message', { user_id: 'user-a', message: 'a'.repeat(4001) }],
    ['лишнее поле', { user_id: 'user-a', message: 'привет', role: 'admin' }],
  ])('отклоняет запрос: %s', async (_name, body) => {
    const res = await request(app.getHttpServer()).post('/chat').send(body).expect(422);

    expect(res.body).toMatchObject({ success: false, data: null, error: 'validation_failed' });
    expect(model.receivedMessages).toHaveLength(0);
  });

  it('тело не в UTF-8 отклоняется, а не сохраняется как мусор', async () => {
    const cp1251 = Buffer.from([
      0x7b, 0x22, 0x75, 0x73, 0x65, 0x72, 0x5f, 0x69, 0x64, 0x22, 0x3a, 0x22, 0x61, 0x22, 0x2c, 0x22, 0x6d, 0x65, 0x73,
      0x73, 0x61, 0x67, 0x65, 0x22, 0x3a, 0x22, 0xf7, 0xe0, 0xe9, 0x22, 0x7d,
    ]);

    const res = await request(app.getHttpServer())
      .post('/chat')
      .set('Content-Type', 'application/json')
      .send(cp1251)
      .expect(422);

    expect(res.body).toMatchObject({ error: 'validation_failed' });
    expect(model.receivedMessages).toHaveLength(0);
  });

  it('некорректный JSON даёт 400 в едином конверте', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);
    expect(res.body).toEqual({ success: false, data: null, meta: null, error: 'bad_request' });
  });

  it('сбой LLM даёт машинный код без подробностей и не портит память', async () => {
    scriptSaveDrink('чай');
    await chat('user-a', 'Я предпочитаю чай').expect(200);

    const secret = Object.assign(new Error('secret provider details'), { status: 503 });
    model.enqueue(failWith(secret));
    const res = await chat('user-a', 'Какой напиток?').expect(503);
    expect(res.body).toEqual({ success: false, data: null, meta: null, error: 'llm_unavailable' });

    scriptDrinkQuestion();
    const after = await chat('user-a', 'Какой напиток?').expect(200);
    expect(replyOf(after)).toContain('чай');
  });

  it('сбой хранилища даёт 500, модель не может ответить «запомнил»', async () => {
    await app.close();
    await startApp({
      load: () => Promise.resolve({}),
      upsert: () => Promise.reject(new Error('disk full')),
    });
    model.enqueue(callTool(SAVE, { ...DRINK, value: 'чай' }), say('Запомнил'));

    const res = await chat('user-a', 'Я предпочитаю чай').expect(500);

    expect(res.body).toEqual({ success: false, data: null, meta: null, error: 'internal_error' });
  });
});
