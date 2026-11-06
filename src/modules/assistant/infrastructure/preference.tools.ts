import { Logger } from '@nestjs/common';
import { tool } from 'langchain';
import { z } from 'zod';
import type { PreferencesService } from '../application/preferences.service';

export const SAVE_PREFERENCE_TOOL = 'save_preference';
export const GET_PREFERENCES_TOOL = 'get_preferences';

const log = new Logger('PreferenceTools');

export const savePreferenceSchema = z.object({
  category: z.string().trim().min(1).max(100).describe('Общая тема, например «напитки» или «спорт»'),
  key: z.string().trim().min(1).max(100).describe('Что именно запоминаем, например «предпочитаемый напиток»'),
  value: z.string().trim().min(1).max(2000).describe('Значение предпочтения своими словами пользователя'),
});

export const getPreferencesSchema = z.object({
  category: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Тема из оглавления. Без этого поля инструмент вернёт оглавление: темы и ключи без значений'),
});

/**
 * user_id закреплён замыканием и отсутствует в схемах аргументов, поэтому модель не может его выбрать.
 *
 * Агент передаёт ошибку инструмента обратно модели, и та могла бы ответить «сохранил». Поэтому сбой
 * хранилища идёт в onStorageFailure, который прерывает запрос целиком.
 */
export function createPreferenceTools(
  userId: string,
  preferences: PreferencesService,
  onStorageFailure: (error: unknown) => void,
) {
  const reportingFailure = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      onStorageFailure(error);
      throw error;
    }
  };

  return [
    tool(
      async (input) => {
        const outcome = await reportingFailure(() => preferences.save(userId, input));
        log.log(`${SAVE_PREFERENCE_TOOL} user_id=${userId} outcome=${outcome}`);
        return JSON.stringify({ saved: true, outcome });
      },
      {
        name: SAVE_PREFERENCE_TOOL,
        description: 'Сохраняет предпочтение пользователя или заменяет прежнее значение с той же парой category и key.',
        schema: savePreferenceSchema,
      },
    ),
    tool(
      async ({ category }) => {
        const view = await reportingFailure(() => preferences.read(userId, category));
        log.log(`${GET_PREFERENCES_TOOL} user_id=${userId} view=${view.view}`);
        return JSON.stringify(view);
      },
      {
        name: GET_PREFERENCES_TOOL,
        description: 'Читает память пользователя: без category возвращает оглавление, с category возвращает значения.',
        schema: getPreferencesSchema,
      },
    ),
  ];
}
