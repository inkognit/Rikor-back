import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFilePreferencesRepository } from '../json-file-preferences.repository';

const TEA = { category: 'напитки', key: 'напиток', value: 'чай' };

/** Интеграционный тест: настоящая файловая система во временной папке. */
describe('JsonFilePreferencesRepository', () => {
  let dataDir: string;
  let repository: JsonFilePreferencesRepository;

  const files = () => readdirSync(join(dataDir, 'users'));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rikor-repo-'));
    repository = new JsonFilePreferencesRepository(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('новый пользователь имеет пустую память', async () => {
    expect(await repository.load('user-a')).toEqual({});
  });

  it('данные переживают создание нового экземпляра', async () => {
    await repository.upsert('user-a', [TEA]);

    expect(await new JsonFilePreferencesRepository(dataDir).load('user-a')).toEqual({ напитки: { напиток: 'чай' } });
  });

  it('параллельные сохранения одного пользователя не теряют данные', async () => {
    const keys = Array.from({ length: 25 }, (_, index) => `ключ ${index}`);

    await Promise.all(keys.map((key) => repository.upsert('user-a', [{ ...TEA, key }])));

    const stored = await repository.load('user-a');
    expect(Object.keys(stored['напитки'] ?? {}).sort()).toEqual([...keys].sort());
    expect(files()).toHaveLength(1); // временных файлов не осталось
  });

  it('параллельные чтения и записи не падают', async () => {
    const operations = Array.from({ length: 20 }, (_, index) =>
      index % 2 ? repository.load('user-a') : repository.upsert('user-a', [{ ...TEA, value: `значение ${index}` }]),
    );

    await expect(Promise.all(operations)).resolves.toHaveLength(20);
  });

  it.each([
    ['регистр', 'Alice', 'alice'],
    ['зарезервированное имя Windows', 'con', 'nul'],
    ['символы', 'user:1', 'user.1'],
  ])('разные user_id не попадают в один файл: %s', async (_name, first, second) => {
    await repository.upsert(first, [TEA]);

    expect(await repository.load(second)).toEqual({});
    await repository.upsert(second, [{ ...TEA, value: 'кофе' }]);
    expect(await repository.load(first)).toEqual({ напитки: { напиток: 'чай' } });
    expect(files()).toHaveLength(2);
  });

  it('пакет записывается целиком и сообщает результат по каждой записи', async () => {
    await repository.upsert('user-a', [TEA]);

    const outcomes = await repository.upsert('user-a', [
      TEA,
      { ...TEA, value: 'кофе' },
      { category: 'хобби', key: 'хобби', value: 'рыбалка' },
    ]);

    expect(outcomes).toEqual(['unchanged', 'updated', 'created']);
    expect(await repository.load('user-a')).toEqual({ напитки: { напиток: 'кофе' }, хобби: { хобби: 'рыбалка' } });
  });

  it('повторное сохранение того же значения не переписывает файл', async () => {
    await repository.upsert('user-a', [TEA]);
    expect(await repository.upsert('user-a', [TEA])).toEqual(['unchanged']);
  });

  it('повреждённый файл даёт ошибку и не затирается, очередь после этого работает', async () => {
    await repository.upsert('user-a', [TEA]);
    const path = join(dataDir, 'users', files()[0] as string);
    writeFileSync(path, '{broken');

    await expect(repository.upsert('user-a', [{ ...TEA, value: 'кофе' }])).rejects.toThrow(SyntaxError);
    await expect(repository.load('user-a')).rejects.toThrow(SyntaxError);

    writeFileSync(path, JSON.stringify({ userId: 'user-a', preferences: { напитки: { напиток: 'чай' } } }));
    expect(await repository.load('user-a')).toEqual({ напитки: { напиток: 'чай' } });
  });
});
