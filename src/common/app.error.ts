/** Прикладная ошибка: несёт машинный код и HTTP-статус, которые отдаёт глобальный фильтр. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = new.target.name;
  }
}
