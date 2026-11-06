import { Inject, Injectable } from '@nestjs/common';
import {
  buildIndex,
  CategoryIndexEntry,
  normalizeName,
  PreferenceInput,
  readCategory,
  SaveOutcome,
} from '../domain/preferences';
import { PREFERENCES_REPOSITORY } from './preferences.port';
import type { PreferencesRepository } from './preferences.port';

export type PreferencesView =
  | { view: 'index'; categories: CategoryIndexEntry[] }
  | { view: 'category'; category: string; found: true; items: Readonly<Record<string, string>> }
  | { view: 'category'; category: string; found: false; knownCategories: string[] };

@Injectable()
export class PreferencesService {
  constructor(@Inject(PREFERENCES_REPOSITORY) private readonly repository: PreferencesRepository) {}

  save(userId: string, input: PreferenceInput): Promise<SaveOutcome> {
    return this.repository.upsert(userId, input);
  }

  /** Без категории возвращает оглавление, с категорией возвращает подробности. */
  async read(userId: string, category?: string): Promise<PreferencesView> {
    const preferences = await this.repository.load(userId);
    const index = buildIndex(preferences);
    if (category === undefined) {
      return { view: 'index', categories: index };
    }

    const name = normalizeName(category);
    const items = readCategory(preferences, name);
    return items
      ? { view: 'category', category: name, found: true, items }
      : { view: 'category', category: name, found: false, knownCategories: index.map((entry) => entry.category) };
  }
}
