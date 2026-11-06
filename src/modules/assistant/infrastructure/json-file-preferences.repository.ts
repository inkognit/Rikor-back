import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PreferencesRepository } from '../application/preferences.port';
import { PreferenceInput, Preferences, SaveOutcome, upsertPreference } from '../domain/preferences';

interface UserFile {
  userId: string;
  preferences: Preferences;
}

/**
 * Один JSON-файл на пользователя. Ограничение: один экземпляр сервиса, очередь живёт внутри процесса.
 *
 * Имя файла является хэшем user_id, а не самим user_id. Иначе на Windows «Alice» и «alice» попали бы
 * в один файл и нарушили изоляцию, а «con» оказался бы зарезервированным именем устройства.
 */
export class JsonFilePreferencesRepository implements PreferencesRepository {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly dataDir: string) {}

  load(userId: string): Promise<Preferences> {
    return this.enqueue(userId, () => this.read(userId));
  }

  upsert(userId: string, input: PreferenceInput): Promise<SaveOutcome> {
    return this.enqueue(userId, async () => {
      const { preferences, outcome } = upsertPreference(await this.read(userId), input);
      if (outcome !== 'unchanged') {
        await this.write(userId, preferences);
      }
      return outcome;
    });
  }

  /** Чтения тоже идут через очередь: на Windows rename падает, пока другой запрос держит файл открытым. */
  private enqueue<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(userId, tail);
    void tail.then(() => {
      if (this.queues.get(userId) === tail) {
        this.queues.delete(userId);
      }
    });
    return result;
  }

  private filePath(userId: string): string {
    const name = createHash('sha256').update(userId).digest('hex');
    return join(this.dataDir, 'users', `${name}.json`);
  }

  /** Отсутствие файла означает пустую память. Повреждённый файл даёт ошибку, чтобы запись его не затёрла. */
  private async read(userId: string): Promise<Preferences> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(userId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
    return (JSON.parse(raw) as UserFile).preferences;
  }

  /** Сбой посреди записи оставляет старый файл целым: новое содержимое появляется через rename. */
  private async write(userId: string, preferences: Preferences): Promise<void> {
    const target = this.filePath(userId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const content: UserFile = { userId, preferences };

    await mkdir(join(this.dataDir, 'users'), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify(content, null, 2), 'utf8');
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
