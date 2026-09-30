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
import {
  createClientErrorReporter,
  type ClientErrorReporter,
} from "../services/clientErrorReporter.js";

export const clientErrorsRouter = new Hono();

const clientErrorsLimiter = createRateLimiter({
  windowMs: env.CLIENT_ERRORS_RATE_WINDOW_MS,
  max: env.CLIENT_ERRORS_RATE_MAX,
  keyPrefix: "client-errors",
});

let reporter: ClientErrorReporter | null = null;

function getReporter(): ClientErrorReporter {
  if (!reporter) {
    reporter = createClientErrorReporter({
      chatId: env.ERROR_ALERT_CHAT_ID,
      enabled: env.CLIENT_ERRORS_ENABLED,
    });
  }
  return reporter;
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

    getReporter().report(parsed.data);
    return c.body(null, 204);
  },
);
