import type { PreferencesRepository } from '../../src/modules/assistant/application/preferences.port';
import {
  PreferenceInput,
  Preferences,
  SaveOutcome,
  upsertPreferences,
} from '../../src/modules/assistant/domain/preferences';

/** Фейк порта для unit-тестов: поведение настоящее, но без диска. */
export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly store = new Map<string, Preferences>();

  load(userId: string): Promise<Preferences> {
    return Promise.resolve(this.store.get(userId) ?? {});
  }

  upsert(userId: string, inputs: readonly PreferenceInput[]): Promise<SaveOutcome[]> {
    const { preferences, outcomes } = upsertPreferences(this.store.get(userId) ?? {}, inputs);
    this.store.set(userId, preferences);
    return Promise.resolve(outcomes);
  }
}
