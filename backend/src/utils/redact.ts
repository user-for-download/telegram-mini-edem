// backend/src/utils/redact.ts
// Редакция чувствительных сегментов URL/пути для логов, алертов и Sentry.
// Секрет webhook-бота живёт в path (/bot/webhook/:secret) и не должен
// попадать в access-log, onError или Telegram-алерт.

const BOT_WEBHOOK_PATH_RE = /\/bot\/webhook\/[^/?#\s]+/g;

/** Заменяет секрет в path на маркер, сохраняя остальную часть пути. */
export function redactSensitivePath(path: string): string {
  return path.replace(BOT_WEBHOOK_PATH_RE, "/bot/webhook/[redacted]");
}

/** То же для абсолютного URL (Sentry request.url и т.п.). */
export function redactSensitiveUrl(url: string): string {
  return url.replace(BOT_WEBHOOK_PATH_RE, "/bot/webhook/[redacted]");
}
