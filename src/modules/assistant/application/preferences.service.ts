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
  | {
      view: 'details';
      found: Record<string, Readonly<Record<string, string>>>;
      missing: string[];
      knownCategories: string[];
    };

@Injectable()
export class PreferencesService {
  constructor(@Inject(PREFERENCES_REPOSITORY) private readonly repository: PreferencesRepository) {}

  save(userId: string, inputs: readonly PreferenceInput[]): Promise<SaveOutcome[]> {
    return this.repository.upsert(userId, inputs);
  }

  /** Без тем возвращает оглавление, с темами возвращает их значения одним ответом. */
  async read(userId: string, categories?: readonly string[]): Promise<PreferencesView> {
    const preferences = await this.repository.load(userId);
    const index = buildIndex(preferences);
    if (!categories?.length) {
      return { view: 'index', categories: index };
    }

    const names = [...new Set(categories.map(normalizeName))];
    const entries = names.map((name) => [name, readCategory(preferences, name)] as const);
    return {
      view: 'details',
      found: Object.fromEntries(entries.flatMap(([name, items]) => (items ? [[name, items] as const] : []))),
      missing: entries.filter(([, items]) => items === null).map(([name]) => name),
      knownCategories: index.map((entry) => entry.category),
    };
  }
}
