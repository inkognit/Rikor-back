import { Logger } from '@nestjs/common';
import { tool } from 'langchain';
import { z } from 'zod';
import type { PreferencesService } from '../application/preferences.service';

export const SAVE_PREFERENCE_TOOL = 'save_preference';
export const GET_PREFERENCES_TOOL = 'get_preferences';

const log = new Logger('PreferenceTools');

const preferenceSchema = z.object({
  category: z.string().trim().min(1).max(100).describe('Общая тема, например «напитки» или «спорт»'),
  key: z.string().trim().min(1).max(100).describe('Что именно запоминаем, например «предпочитаемый напиток»'),
  value: z.string().trim().min(1).max(2000).describe('Значение предпочтения своими словами пользователя'),
});

/**
 * Список в одном вызове, а не один факт на вызов: gpt-oss на Groq не умеет параллельные вызовы, и каждый
 * факт стоил бы отдельного запроса со всей историей. Длинное сообщение упиралось в лимит токенов на полпути.
 */
export const savePreferenceSchema = z.object({
  preferences: z.array(preferenceSchema).min(1).max(30).describe('Все факты из сообщения, по одной записи на факт'),
});

export const getPreferencesSchema = z.object({
  categories: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(30)
    .optional()
    .describe('Все нужные темы из оглавления. Без этого поля инструмент вернёт оглавление: темы и ключи без значений'),
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
        const outcomes = await reportingFailure(() => preferences.save(userId, input.preferences));
        log.log(`${SAVE_PREFERENCE_TOOL} user_id=${userId} outcomes=${outcomes.join(',')}`);
        return JSON.stringify({ saved: true, outcomes });
      },
      {
        name: SAVE_PREFERENCE_TOOL,
        description:
          'Сохраняет сразу все факты о пользователе из сообщения. Запись с той же парой category и key заменяет прежнее значение.',
        schema: savePreferenceSchema,
      },
    ),
    tool(
      async ({ categories }) => {
        const view = await reportingFailure(() => preferences.read(userId, categories));
        log.log(`${GET_PREFERENCES_TOOL} user_id=${userId} view=${view.view}`);
        return JSON.stringify(view);
      },
      {
        name: GET_PREFERENCES_TOOL,
        description:
          'Читает память пользователя: без categories возвращает оглавление, с categories возвращает значения всех перечисленных тем.',
        schema: getPreferencesSchema,
      },
    ),
  ];
}
