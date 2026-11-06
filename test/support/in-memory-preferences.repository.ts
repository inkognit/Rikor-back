import type { PreferencesRepository } from '../../src/modules/assistant/application/preferences.port';
import {
  PreferenceInput,
  Preferences,
  SaveOutcome,
  upsertPreference,
} from '../../src/modules/assistant/domain/preferences';

/** Фейк порта для unit-тестов: поведение настоящее, но без диска. */
export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly store = new Map<string, Preferences>();

  load(userId: string): Promise<Preferences> {
    return Promise.resolve(this.store.get(userId) ?? {});
  }

  upsert(userId: string, input: PreferenceInput): Promise<SaveOutcome> {
    const { preferences, outcome } = upsertPreference(this.store.get(userId) ?? {}, input);
    this.store.set(userId, preferences);
    return Promise.resolve(outcome);
  }
}
