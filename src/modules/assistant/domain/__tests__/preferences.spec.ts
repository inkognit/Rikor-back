import { buildIndex, normalizeName, readCategory, upsertPreference } from '../preferences';

const TEA = { category: 'напитки', key: 'напиток', value: 'чай' };

describe('память о предпочтениях', () => {
  it('создаёт новую запись', () => {
    const { preferences, outcome } = upsertPreference({}, TEA);

    expect(outcome).toBe('created');
    expect(preferences).toEqual({ напитки: { напиток: 'чай' } });
  });

  it('заменяет значение и не трогает соседние записи', () => {
    const start = upsertPreference({}, TEA).preferences;
    const withSport = upsertPreference(start, { category: 'спорт', key: 'вид', value: 'бег' }).preferences;

    const { preferences, outcome } = upsertPreference(withSport, { ...TEA, value: 'кофе' });

    expect(outcome).toBe('updated');
    expect(preferences).toEqual({ напитки: { напиток: 'кофе' }, спорт: { вид: 'бег' } });
  });

  it('повтор с другим регистром и пробелами остаётся той же записью', () => {
    const start = upsertPreference({}, TEA).preferences;

    const { preferences, outcome } = upsertPreference(start, {
      category: '  НАПИТКИ ',
      key: 'Напиток',
      value: ' чай ',
    });

    expect(outcome).toBe('unchanged');
    expect(preferences).toBe(start);
  });

  it('не мутирует исходный объект', () => {
    const start = upsertPreference({}, TEA).preferences;
    upsertPreference(start, { ...TEA, value: 'кофе' });

    expect(start).toEqual({ напитки: { напиток: 'чай' } });
  });

  it.each(['__proto__', 'constructor'])('имя «%s» является обычной строкой', (name) => {
    expect(readCategory({}, name)).toBeNull();

    const { preferences, outcome } = upsertPreference({}, { category: name, key: name, value: 'значение' });
    const restored = JSON.parse(JSON.stringify(preferences)) as typeof preferences;

    expect(outcome).toBe('created');
    expect(readCategory(restored, name)).toEqual(JSON.parse(`{"${name}":"значение"}`));
    expect(Object.getPrototypeOf(preferences)).toBe(Object.prototype);
  });

  it('оглавление содержит темы и ключи без значений', () => {
    const { preferences } = upsertPreference({}, TEA);

    expect(buildIndex(preferences)).toEqual([{ category: 'напитки', keys: ['напиток'] }]);
  });

  it('нормализует имя', () => {
    expect(normalizeName('  Любимый   НАПИТОК ')).toBe('любимый напиток');
  });
});
