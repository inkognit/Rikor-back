import { InMemoryPreferencesRepository } from '../../../../../test/support/in-memory-preferences.repository';
import { PreferencesService } from '../preferences.service';

describe('PreferencesService', () => {
  let service: PreferencesService;

  beforeEach(() => {
    service = new PreferencesService(new InMemoryPreferencesRepository());
  });

  it('данные разных пользователей изолированы', async () => {
    await service.save('user-a', { category: 'напитки', key: 'напиток', value: 'чай' });

    expect(await service.read('user-b')).toEqual({ view: 'index', categories: [] });
    expect(await service.read('user-b', 'напитки')).toEqual({
      view: 'category',
      category: 'напитки',
      found: false,
      knownCategories: [],
    });
  });

  it('без категории возвращает оглавление, с категорией возвращает значения', async () => {
    await service.save('user-a', { category: 'напитки', key: 'напиток', value: 'чай' });

    expect(await service.read('user-a')).toEqual({
      view: 'index',
      categories: [{ category: 'напитки', keys: ['напиток'] }],
    });
    expect(await service.read('user-a', ' Напитки ')).toEqual({
      view: 'category',
      category: 'напитки',
      found: true,
      items: { напиток: 'чай' },
    });
  });

  it('для незнакомой темы сообщает, какие темы известны', async () => {
    await service.save('user-a', { category: 'напитки', key: 'напиток', value: 'чай' });

    expect(await service.read('user-a', 'машины')).toEqual({
      view: 'category',
      category: 'машины',
      found: false,
      knownCategories: ['напитки'],
    });
  });

  it('сообщает, что сделало сохранение', async () => {
    const input = { category: 'напитки', key: 'напиток', value: 'чай' };

    expect(await service.save('user-a', input)).toBe('created');
    expect(await service.save('user-a', input)).toBe('unchanged');
    expect(await service.save('user-a', { ...input, value: 'кофе' })).toBe('updated');
  });
});
