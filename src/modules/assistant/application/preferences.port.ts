import type { PreferenceInput, Preferences, SaveOutcome } from '../domain/preferences';

export const PREFERENCES_REPOSITORY = Symbol('PREFERENCES_REPOSITORY');

export interface PreferencesRepository {
  load(userId: string): Promise<Preferences>;
  /** Чтение и запись выполняются как одна операция: параллельные вызовы не теряют данные. */
  upsert(userId: string, input: PreferenceInput): Promise<SaveOutcome>;
}
