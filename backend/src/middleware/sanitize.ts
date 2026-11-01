// backend/src/middleware/sanitize.ts
import type { Context } from "hono";
import DOMPurify from "isomorphic-dompurify";

const SANITIZE_OPTIONS = { ALLOWED_TAGS: [], ALLOWED_ATTR: [] };

/**
 * Рекурсивно очищает все строки в произвольной структуре данных
 * от HTML/JS (XSS). Разрешённых тегов и атрибутов нет — текст
 * остаётся чистым.
 */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return DOMPurify.sanitize(value, SANITIZE_OPTIONS);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      obj[key] = sanitizeValue((value as Record<string, unknown>)[key]);
    }
    return obj;
  }
  return value;
}

/**
 * Читает JSON-тело запроса и возвращает очищенную от HTML копию.
 * Используется в мутациях вместо прямого `c.req.json()`.
 */
export async function getSanitizedBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => ({}));
  return sanitizeValue(raw) as Record<string, unknown>;
}

/**
 * Собирает query-параметры в объект и чистит строки от HTML.
 *
 * `getSanitizedBody` для GET не подходит (тела нет), а `sanitizeValue(c.req.query())`
 * теряет дубли ключей: `?page=1&page=2` схлопывается в последнее значение,
 * поэтому клиент и прокси/лимитер могут видеть разные запросы. При дубле
 * возвращаем `null` — контракт отклонит запрос как невалидный.
 */
export function getSanitizedQuery(c: Context): Record<string, unknown> | null {
  const params = new URL(c.req.url).searchParams;
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();

  for (const [key, value] of params) {
    if (keys.has(key)) return null;
    keys.add(key);
    entries.push([key, sanitizeValue(value)]);
  }

  return Object.fromEntries(entries);
}
