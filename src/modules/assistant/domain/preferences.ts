/** Память пользователя: категория → ключ → значение. Пара категория и ключ уникальна по структуре. */
export type Preferences = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface PreferenceInput {
  category: string;
  key: string;
  value: string;
}

export type SaveOutcome = 'created' | 'updated' | 'unchanged';

export interface CategoryIndexEntry {
  category: string;
  keys: string[];
}

/** Приводит имя к одному виду: «  Напитки » и «напитки» должны попасть в одну запись. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Имена приходят от модели, поэтому «__proto__» и «constructor» здесь обычные строки.
 * Чтение идёт только по собственным свойствам, запись через вычисляемый ключ не трогает прототип.
 */
export function upsertPreference(
  current: Preferences,
  input: PreferenceInput,
): { preferences: Preferences; outcome: SaveOutcome } {
  const category = normalizeName(input.category);
  const key = normalizeName(input.key);
  const value = input.value.trim();

  const items = readCategory(current, category) ?? {};
  const previous = Object.hasOwn(items, key) ? items[key] : undefined;
  if (previous === value) {
    return { preferences: current, outcome: 'unchanged' };
  }

  return {
    preferences: { ...current, [category]: { ...items, [key]: value } },
    outcome: previous === undefined ? 'created' : 'updated',
  };
}

/** Оглавление вычисляется из данных, поэтому не может с ними разойтись. */
export function buildIndex(preferences: Preferences): CategoryIndexEntry[] {
  return Object.entries(preferences).map(([category, items]) => ({ category, keys: Object.keys(items) }));
}

export function readCategory(preferences: Preferences, category: string): Readonly<Record<string, string>> | null {
  const name = normalizeName(category);
  return Object.hasOwn(preferences, name) ? (preferences[name] ?? null) : null;
}
