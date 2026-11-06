export type ErrorMeta = Record<string, unknown>;

/** Прикладная ошибка: несёт машинный код, HTTP-статус и подробности, которые отдаёт глобальный фильтр. */
export class AppError extends Error {
  readonly meta: ErrorMeta | null;

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    options?: ErrorOptions & { meta?: ErrorMeta },
  ) {
    super(code, options);
    this.name = new.target.name;
    this.meta = options?.meta ?? null;
  }
}

/** Только имя, статус и код: текст ошибки провайдера может содержать фрагменты запроса пользователя. */
export function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return 'none';
  }
  const { status, code } = cause as { status?: unknown; code?: unknown };
  const parts = [
    cause.name,
    typeof status === 'number' ? status : undefined,
    typeof code === 'string' ? code : undefined,
  ];
  return parts.filter((part) => part !== undefined).join(':');
}
