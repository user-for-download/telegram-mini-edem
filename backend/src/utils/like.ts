// backend/src/utils/like.ts
//
// Экранирование спецсимволов LIKE для Prisma `contains`/`startsWith`/
// `endsWith`. Prisma подставляет пользовательское значение в LIKE-паттерн
// как есть, поэтому `%` и `_` работают как джокеры: `q=%` совпал бы с любой
// строкой (фильтр «проваливается» и молча отдаёт всё). Postgres LIKE по
// умолчанию использует `\` как escape-символ, поэтому достаточно
// заэкранировать `\`, `%`, `_`.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
