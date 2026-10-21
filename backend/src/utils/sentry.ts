// backend/src/utils/sentry.ts
// Единственная точка инициализации Sentry и вспомогательные хелперы захвата.
// Импорт модуля не имеет side-effect'ов: Sentry.init вызывается только через initSentry().
import * as Sentry from "@sentry/node";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { redactSensitivePath } from "./redact.js";

const SENSITIVE_EXTRA_KEY_FRAGMENTS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "credential",
  "session",
  "jwt",
  "webhook",
  "sign",
];

const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\btgWebAppData=[^\s&]*/gi, "tgWebAppData=[redacted]"],
  [/\bhash=[^\s&]*/gi, "hash=[redacted]"],
  [/\b[0-9a-fA-F]{32,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [
    /(?:\+7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g,
    "[phone]",
  ],
  [/\b\d{7,}\b/g, "[number]"],
  [/\?[^\s]*/g, "?[redacted]"],
];

function redactText(value: string): string {
  let result = redactSensitivePath(value);
  for (const [pattern, replacement] of SENSITIVE_TEXT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_EXTRA_KEY_FRAGMENTS.some((fragment) =>
    lower.includes(fragment),
  );
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted]";
  if (typeof value === "string") return redactText(value);
  // Длинные числовые значения — почти всегда Telegram/DB id (PII).
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) >= 1_000_000
  ) {
    return "[number]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      scrubbed[key] = scrubValue(item, depth + 1);
    }
    return scrubbed;
  }
  return value;
}

export interface CaptureContext {
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
}

/**
 * Очистка события от PII перед отправкой в Sentry.
 * Убираем user, оставляем только url/method в request,
 * вырезаем чувствительные ключи из extra. Никогда не бросает.
 */
function stripPii(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  try {
    if (event.user) {
      event.user = {};
    }

    if (event.request) {
      event.request = {
        url: event.request.url ? redactText(event.request.url) : event.request.url,
        method: event.request.method,
      };
    }

    if (event.message) {
      event.message = redactText(event.message);
    }
    if (event.transaction) {
      event.transaction = redactText(event.transaction);
    }

    if (event.extra) {
      event.extra = scrubValue(event.extra) as Record<string, unknown>;
    }
    if (event.contexts) {
      event.contexts = scrubValue(event.contexts) as typeof event.contexts;
    }
    if (event.tags) {
      event.tags = scrubValue(event.tags) as Record<string, string>;
    }

    if (event.exception?.values) {
      for (const exception of event.exception.values) {
        if (typeof exception.value === "string") {
          exception.value = redactText(exception.value);
        }
      }
    }

    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (typeof breadcrumb.message === "string") {
          breadcrumb.message = redactText(breadcrumb.message);
        }
        if (breadcrumb.data) {
          breadcrumb.data = scrubValue(breadcrumb.data) as Record<
            string,
            unknown
          >;
        }
      }
    }
  } catch {
    // beforeSend не должен ронять отправку события
  }
  return event;
}

/** Инициализация Sentry. Без SENTRY_DSN — no-op (Sentry выключен). */
export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.info("sentry_disabled_no_dsn");
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.APP_VERSION || "unknown",
    tracesSampleRate: env.isProduction ? 0.1 : 1.0,
    profilesSampleRate: env.isProduction ? 0.1 : 0,
    beforeSend: (event) => stripPii(event),
  });
}

/** Предупреждение в Sentry; без DSN — только лог уровня warn. */
export function captureWarning(
  message: string,
  context: CaptureContext = {}
): void {
  if (!env.SENTRY_DSN) {
    logger.warn({ message, extra: context.extra }, "sentry_warning_suppressed_no_dsn");
    return;
  }
  Sentry.captureMessage(message, { level: "warning", ...context });
}

/** Исключение в Sentry; без DSN — только лог уровня error. */
export function captureException(
  exception: unknown,
  context: CaptureContext = {}
): void {
  if (!env.SENTRY_DSN) {
    logger.error({ err: exception, extra: context.extra }, "sentry_exception_suppressed_no_dsn");
    return;
  }
  Sentry.captureException(exception, context);
}
