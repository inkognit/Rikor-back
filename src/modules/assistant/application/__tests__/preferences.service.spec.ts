import { InMemoryPreferencesRepository } from '../../../../../test/support/in-memory-preferences.repository';
import { PreferencesService } from '../preferences.service';

describe('PreferencesService', () => {
  let service: PreferencesService;

  beforeEach(() => {
    service = new PreferencesService(new InMemoryPreferencesRepository());
  });

  it('данные разных пользователей изолированы', async () => {
    await service.save('user-a', [{ category: 'напитки', key: 'напиток', value: 'чай' }]);

    expect(await service.read('user-b')).toEqual({ view: 'index', categories: [] });
    expect(await service.read('user-b', ['напитки'])).toEqual({
      view: 'details',
      found: {},
      missing: ['напитки'],
      knownCategories: [],
    });
  });

  it('без категории возвращает оглавление, с категорией возвращает значения', async () => {
    await service.save('user-a', [{ category: 'напитки', key: 'напиток', value: 'чай' }]);

    expect(await service.read('user-a')).toEqual({
      view: 'index',
      categories: [{ category: 'напитки', keys: ['напиток'] }],
    });
    expect(await service.read('user-a', [' Напитки '])).toEqual({
      view: 'details',
      found: { напитки: { напиток: 'чай' } },
      missing: [],
      knownCategories: ['напитки'],
    });
  });

  it('для незнакомой темы сообщает, какие темы известны', async () => {
    await service.save('user-a', [{ category: 'напитки', key: 'напиток', value: 'чай' }]);

    expect(await service.read('user-a', ['машины'])).toEqual({
      view: 'details',
      found: {},
      missing: ['машины'],
      knownCategories: ['напитки'],
    });
  });

  it('читает несколько тем одним вызовом и не повторяет их', async () => {
    await service.save('user-a', [
      { category: 'напитки', key: 'напиток', value: 'чай' },
      { category: 'хобби', key: 'хобби', value: 'рыбалка' },
    ]);

    expect(await service.read('user-a', ['напитки', 'ХОББИ', 'напитки', 'машины'])).toEqual({
      view: 'details',
      found: { напитки: { напиток: 'чай' }, хобби: { хобби: 'рыбалка' } },
      missing: ['машины'],
      knownCategories: ['напитки', 'хобби'],
    });
  });

  it('сообщает, что сделало сохранение', async () => {
    const input = { category: 'напитки', key: 'напиток', value: 'чай' };

    expect(await service.save('user-a', [input])).toEqual(['created']);
    expect(await service.save('user-a', [input])).toEqual(['unchanged']);
    expect(await service.save('user-a', [{ ...input, value: 'кофе' }])).toEqual(['updated']);
  });
});
