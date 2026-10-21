import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import { createNodeWebSocket } from "@hono/node-ws";
import fs from "node:fs";
import path from "node:path";

import { authRouter } from "./auth/index.js";
import { tripsRouter } from "./trips/index.js";
import { bookingsRouter } from "./bookings/index.js";
import { reviewsRouter } from "./reviews/index.js";
import { feedbackRouter } from "./feedback/index.js";
import {
  clientErrorsRouter,
  reportServerError,
} from "./client-errors/index.js";
import { usersRouter } from "./users/index.js";
import { adminRouter } from "./admin/index.js";
import { citiesRouter } from "./cities/index.js";
import { notificationsRouter } from "./notifications/index.js";
import { rideRequestsRouter } from "./rideRequests/index.js";
import { reportsRouter, adminReportsRouter } from "./reports/index.js";
import { botRouter } from "./bot/index.js";
import { createWsHandler, isWsOriginAllowed } from "./ws/index.js";

import { env } from "./env.js";
import { db } from "./db.js";
import { Prisma } from "./generated/prisma/client.js";
import { logger } from "./logger.js";
import { Sentry } from "./sentry.js";
import { ERROR_CODES } from "./errors.js";
import { httpRequestsTotal, metricsSnapshot } from "./metrics.js";
import {
  getTelegramDeliveryMetrics,
  renderTelegramMetrics,
} from "./services/telegramMetrics.js";
import { tokensEqual } from "./utils/timingSafeEqual.js";
import { redactSensitivePath } from "./utils/redact.js";
import { registerNotificationSubscribers } from "./events/notificationSubscriber.js";

export const app = new Hono();

// Подписки уведомлений на доменные события — один раз на модуль.
// Здесь, а не в index.ts: тесты импортируют app напрямую, и регистрация
// в точке входа оставила бы их без подписок. Модуль выполняется один
// раз, флаг идемпотентности в register — вторая страховка.
registerNotificationSubscribers();

/**
 * Кап размера одного WS-фрейма.
 *
 * `ws` по умолчанию принимает кадры до 100 MiB, а `onMessage`
 * (ws/index.ts) делает `JSON.parse(String(evt.data))` над всем фреймом —
 * анонимный флуд гигантскими кадрами давал бы CPU/память-amplification
 * ещё до проверки схемы. Клиентские WS-сообщения — auth-токен и ping/pong
 * (десятки байт), 64 KB с большим запасом. `wss.options.maxPayload`
 * читается per-connection (ws v8, completeUpgrade), поэтому установка
 * здесь применяется ко всем новым соединениям.
 */
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app });
wss.options.maxPayload = WS_MAX_PAYLOAD_BYTES;
export { injectWebSocket };

const allowedOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const sentryOrigin = (() => {
  if (!env.SENTRY_DSN) return null;

  try {
    return new URL(env.SENTRY_DSN).origin;
  } catch {
    return null;
  }
})();

// connect-src без глобальных ws:/wss:: разрешаем только same-origin,
// Sentry и WS-схемы явно перечисленных origins (CORS_ORIGINS +
// TELEGRAM_WEBAPP_URL). Иначе XSS мог exfiltrate данные на любой WSS.
const connectSources = new Set<string>(["'self'"]);
for (const origin of [...allowedOrigins, env.TELEGRAM_WEBAPP_URL]) {
  if (!origin) continue;
  try {
    const parsed = new URL(origin);
    connectSources.add(parsed.origin);
    connectSources.add(
      `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`,
    );
  } catch {
    // Некорректный origin в env не должен ломать старт: он просто не
    // попадает в CSP (fail-closed для подключения).
  }
}
if (sentryOrigin) connectSources.add(sentryOrigin);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Аватары Telegram — только известные CDN-хосты, без глобального https:.
  "img-src 'self' data: blob: https://t.me https://telegram.org https://*.telegram.org https://*.telegram-cdn.org",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src ${[...connectSources].join(" ")}`,
  "manifest-src 'self'",
  "frame-ancestors 'self'",
].join("; ");

function applySecurityHeaders(c: Context): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", contentSecurityPolicy);
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (env.isProduction) {
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
}

app.use(
  "*",
  cors({
    origin: (origin: string | undefined) => {
      if (!origin) {
        return undefined;
      }
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return undefined;
    },
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);

/**
 * Структурированный access-log.
 *
 * Метрика и лог пишутся в finally: запросы, завершившиеся необработанной
 * ошибкой (onError), тоже должны попадать в access-log и http_requests_total.
 * Для таких запросов финальный статус ещё не установлен (onError сработает
 * после middleware), поэтому пишем флаг errored, а саму ошибку логирует onError.
 */
app.use("*", async (c, next) => {
  const startedAt = Date.now();
  let errored = false;

  try {
    await next();
  } catch (error) {
    errored = true;
    throw error;
  } finally {
    httpRequestsTotal.inc();

    logger.info(
      {
        method: c.req.method,
        path: redactSensitivePath(c.req.path),
        status: errored ? undefined : c.res.status,
        errored,
        durationMs: Date.now() - startedAt,
      },
      "http_request",
    );
  }
});

/**
 * Security headers.
 *
 * Приложение открывается только в Telegram WebView (same-origin через
 * reverse proxy), фрейминг чужими сайтами запрещён: X-Frame-Options не
 * выставляем (устарел и конфликтует с WebView), вместо него CSP
 * frame-ancestors ограничивает встраивание только собственным origin.
 */
app.use("*", async (c, next) => {
  // Заголовки ставим ДО next(): onError формирует ответ в обход этого
  // middleware, а после next() на исключении код просто не выполнится.
  applySecurityHeaders(c);
  await next();
});

/**
 * Ограничение размера тела запроса (100 KB).
 * bodyLimit учитывает и chunked-запросы (Transfer-Encoding), в отличие от
 * проверки одного заголовка content-length.
 */
app.use(
  "*",
  bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) =>
      c.json(
        { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Payload too large" },
        413,
      ),
  }),
);

// Webhook Telegram-бота: секрет в path, сравнение timing-safe.
// Монтируется до API-роутов; запросы идут от серверов Telegram.
app.route("/bot", botRouter);

/**
 * Проверка подключения к БД.
 */
async function checkDatabase(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

app.get("/health", async (c) => {
  const dbOk = await checkDatabase();
  return c.json(
    {
      status: dbOk ? "ok" : "degraded",
      service: "edem-backend",
      db: dbOk,
      time: new Date().toISOString(),
    },
    dbOk ? 200 : 503,
  );
});

app.get("/health/live", (c) => {
  return c.json({ status: "alive" });
});

app.get("/health/ready", async (c) => {
  const dbOk = await checkDatabase();
  return c.json({ ready: dbOk }, dbOk ? 200 : 503);
});

/**
 * Метрики сервиса в Prometheus text-формате.
 * В production endpoint закрыт, даже если токен ошибочно не настроен.
 * TG-outbox агрегаты добавляются отдельным блоком (наблюдаемость outbox).
 */
app.get("/metrics", async (c) => {
  if (!env.METRICS_TOKEN) {
    if (env.isProduction) return c.notFound();
  } else {
    const authorization = c.req.header("Authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);

    if (!match || !tokensEqual(match[1], env.METRICS_TOKEN)) {
      return c.text("Forbidden", 403);
    }
  }

  const tgMetrics = await getTelegramDeliveryMetrics();
  return c.text(metricsSnapshot() + renderTelegramMetrics(tgMetrics), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

app.route("/api/v1/auth", authRouter);
app.route("/api/v1/trips", tripsRouter);
app.route("/api/v1/bookings", bookingsRouter);
app.route("/api/v1/reviews", reviewsRouter);
app.route("/api/v1/feedback", feedbackRouter);
app.route("/api/v1/client-errors", clientErrorsRouter);
app.route("/api/v1/notifications", notificationsRouter);
app.route("/api/v1/ride-requests", rideRequestsRouter);
app.route("/api/v1/reports", reportsRouter);
app.route("/api/v1/admin/reports", adminReportsRouter);
app.route("/api/v1/users", usersRouter);
app.route("/api/v1/cities", citiesRouter);
app.route("/api/v1/admin", adminRouter);
app.get(
  "/api/v1/ws",
  async (c, next) => {
    if (!isWsOriginAllowed(c)) {
      return c.text("Forbidden", 403);
    }
    return next();
  },
  createWsHandler(upgradeWebSocket),
);

if (env.isProduction) {
  // Telegram-only SPA-раздача.
  // Host-гейт оставлен: TELEGRAM_HOSTS ограничивает, какие хосты получают
  // приложение; остальные — 404, а не чужой фронт.
  const tgDistPath = path.resolve(process.cwd(), "telegram-app/dist");

  // index.html читаем один раз при старте, а не на каждый SPA-запрос
  const readIndex = (distPath: string, label: string): string | null => {
    try {
      return fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    } catch {
      logger.error(
        { distPath },
        `Frontend build (index.html) not found for ${label}`,
      );
      return null;
    }
  };
  const tgIndexHtml =
    env.TELEGRAM_HOSTS.length > 0
      ? readIndex(tgDistPath, "telegram-app")
      : null;

  const tgStatic = serveStatic({
    root: path.relative(process.cwd(), tgDistPath),
  });

  const isTelegramHost = (c: {
    req: { header: (name: string) => string | undefined };
  }): boolean => {
    if (env.TELEGRAM_HOSTS.length === 0) return false;
    const host = (c.req.header("host") || "").split(":")[0].toLowerCase();
    return env.TELEGRAM_HOSTS.includes(host);
  };

  app.use("/*", async (c, next) => {
    if (!isTelegramHost(c)) {
      return c.text("Not found", 404);
    }
    // Хэшированные ассеты immutable на год (заголовок ДО serveStatic,
    // иначе не попадёт в финализированный ответ); index.html и остальное —
    // без кэша (иначе WebView после ребилда указывает на удалённые файлы).
    if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      // index.html и SPA-fallback: всегда свежие (serveStatic отдаёт
      // корневой / сам, до app.get("*") дело не доходит).
      c.header("Cache-Control", "no-store");
    }
    return tgStatic(c, next);
  });
  app.get("*", (c) => {
    // Неизвестные API-запросы не должны попадать в SPA-fallback:
    // возвращаем 404 JSON в общем формате ошибок, а не index.html.
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      return c.json({ code: ERROR_CODES.NOT_FOUND, message: "Not found" }, 404);
    }

    if (isTelegramHost(c) && tgIndexHtml) {
      c.header("Cache-Control", "no-store");
      return c.html(tgIndexHtml);
    }
    return c.text("Frontend build not found", 404);
  });
}

/**
 * Единый JSON-404 для несуществующих маршрутов.
 *
 * В production SPA-блок ловит всё, сюда доходят только `c.notFound()` из
 * кода (например /metrics без токена); вне production любой неизвестный
 * маршрут идёт прямиком сюда. Раньше был дефолтный текст Hono
 * «404 Not Found», а контракт API обещает `{code, message}` — теперь
 * API-пути получают JSON, остальные — короткий текст.
 */
app.notFound((c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
    return c.json({ code: ERROR_CODES.NOT_FOUND, message: "Not found" }, 404);
  }
  return c.text("Not found", 404);
});

/**
 * Глобальная обработка ошибок. Вынесена в экспортируемую функцию,
 * чтобы путь server-error можно было прогнать тестом (публичный
 * эндпоинт kind "server" отклоняет — и это правильно).
 */
export function handleUnhandledError(error: Error, c: Context) {
  // onError не проходит через middleware заголовков — ставим их здесь,
  // иначе 500/404/409 уходили без CSP/nosniff/HSTS.
  applySecurityHeaders(c);

  // Известные Prisma-ошибки, доехавшие сюда необработанными (гонки
  // check-then-act: запись по строке, удалённой параллельно). Контракт
  // требует мапить их без 500 и без алертов: P2025 → 404, P2034 → 409
  // с retryable:true (тот же код, что у локальных catch'ей, — это
  // страховка на пути, где локальный маппинг забыли).
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return c.json({ code: ERROR_CODES.NOT_FOUND, message: "Not found" }, 404);
    }
    if (error.code === "P2034") {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Concurrent update conflict, please retry",
          retryable: true,
        },
        409,
      );
    }
  }

  logger.error(
    {
      err: error,
      method: c.req.method,
      path: redactSensitivePath(c.req.path),
    },
    "unhandled_error",
  );

  if (env.SENTRY_DSN) {
    Sentry.captureException(error);
  }

  // Серверные 5xx — в тот же Telegram-канал, что клиентские ошибки.
  reportServerError(error, c.req.method, redactSensitivePath(c.req.path));

  return c.json(
    { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error" },
    500,
  );
}

app.onError(handleUnhandledError);
