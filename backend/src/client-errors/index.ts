// backend/src/client-errors/index.ts
//
// POST /api/v1/client-errors — приём отчётов о клиентских ошибках.
// Публичный (ошибки бывают до авторизации), ответ 204, когда тело принято.
//
// Защита публичного эндпоинта: свой bodyLimit 16 KB, лимитер 10 req/мин
// с IP, Zod-проверка, санитайзинг и потолок алертов в сервисе
// (clientErrorReporter). sendBeacon шлёт text/plain — тело читаем через
// c.req.text() + JSON.parse в try/catch. User-Agent берём из заголовка.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clientErrorSchema } from "@edem/contracts";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { env } from "../env.js";
import { ERROR_CODES } from "../errors.js";
import { logger } from "../logger.js";
import {
  createClientErrorReporter,
  isStackFrameLine,
  type ClientErrorReporter,
} from "../services/clientErrorReporter.js";

export const clientErrorsRouter = new Hono();

const clientErrorsLimiter = createRateLimiter({
  windowMs: env.CLIENT_ERRORS_RATE_WINDOW_MS,
  max: env.CLIENT_ERRORS_RATE_MAX,
  keyPrefix: "client-errors",
});

let reporter: ClientErrorReporter | null = null;

export function getClientErrorReporter(): ClientErrorReporter {
  if (!reporter) {
    reporter = createClientErrorReporter({
      chatId: env.ERROR_ALERT_CHAT_ID,
      enabled: env.CLIENT_ERRORS_ENABLED,
    });
  }
  return reporter;
}

// Отдельный инстанс со своим бюджетом: флуд публичного эндпоинта
// не должен глушить алерты настоящих серверных 5xx.
let serverReporter: ClientErrorReporter | null = null;

export function getServerErrorReporter(): ClientErrorReporter {
  if (!serverReporter) {
    serverReporter = createClientErrorReporter({
      chatId: env.ERROR_ALERT_CHAT_ID,
      enabled: env.CLIENT_ERRORS_ENABLED,
    });
  }
  return serverReporter;
}

clientErrorsRouter.post(
  "/",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) =>
      c.json(
        { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Payload too large" },
        413,
      ),
  }),
  clientErrorsLimiter,
  async (c) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid JSON body" },
        400,
      );
    }

    const parsed = clientErrorSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Invalid client error payload",
        },
        400,
      );
    }

    getClientErrorReporter().report(parsed.data);
    return c.body(null, 204);
  },
);

/**
 * Серверные 5xx в тот же канал: вызывается из app.onError и из
 * route-level catch перед ответом 500 (там же — pino-лог через
 * logger.error({ err }), полный текст остаётся в логах). В Telegram
 * уходит только имя ошибки, маршрут и пара кадров стека: тексты
 * серверных исключений могут содержать e-mail и данные из БД.
 * Никогда не бросает: репортёр fire-and-forget, сверху страховочный
 * try/catch, чтобы не уронить ответ 500.
 */
export function reportServerError(
  error: unknown,
  method: string,
  path: string,
): void {
  try {
    const name =
      error instanceof Error
        ? error.name || "Error"
        : typeof error === "string"
          ? "String"
          : "Unknown";
    const frames = (error instanceof Error ? (error.stack ?? "") : "")
      .split("\n")
      .map((line) => line.trim())
      // Только кадры (isStackFrameLine): заголовок с текстом
      // исключения в алерт не берём — он остаётся в pino.
      .filter((line) => isStackFrameLine(line))
      .slice(0, 2)
      .join("\n");
    getServerErrorReporter().report({
      kind: "server",
      message: name,
      stack: frames || undefined,
      route: `${method} ${path}`.slice(0, 200),
    });
  } catch (reportError) {
    logger.debug({ err: reportError }, "server_error_report_failed");
  }
}
