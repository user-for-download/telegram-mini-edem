// backend/src/env.ts
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Поиск .env: для запуска из src (tsx) и из dist (скопилированный JS)
const envPathDev = path.resolve(__dirname, "../.env");
const envPathProd = path.resolve(__dirname, "../../.env");
dotenv.config({ path: fs.existsSync(envPathDev) ? envPathDev : envPathProd });

const NODE_ENV = process.env.NODE_ENV ?? "development";
const isProduction = NODE_ENV === "production";
const isDevelopment = NODE_ENV === "development";

/**
 * Dev-множитель rate-лимитов: в development все MAX-лимиты ×100.
 *
 * Зачем: dev-стенд делит один IP-бюджет (Vite-прокси, HMR-перезаходы,
 * e2e-прогоны) — продовые 5 входов/5 мин постоянно дают 429
 * «Слишком много попыток входа» и валят разработку.
 *
 * Границы безопасности:
 * - явный ENV всегда побеждает (positiveIntEnv читает process.env первым);
 * - NODE_ENV=test (vitest, .env.test) — строгие продовые значения:
 *   user-rate-limit.test.ts завязан на 10 поездок/сутки → 429;
 * - production — без изменений.
 */
const DEV_RATE_MULTIPLIER = 100;
export function devRateMax(prodDefault: number): number {
  return isDevelopment ? prodDefault * DEV_RATE_MULTIPLIER : prodDefault;
}

function failMissingEnv(name: string): never {
  throw new Error(`[env] Missing required environment variable: ${name}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    failMissingEnv(name);
  }

  return value;
}

export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`[env] ${name} must be a positive integer.`);
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`[env] ${name} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Явный allowlist пользователей, которым разрешены dev mock-токены
 * (DEV_AUTH_USER_ALLOWLIST: comma-separated user id).
 *
 * Читаем из process.env при КАЖДОМ вызове, а не снапшотим в env-объект:
 * интеграционные тесты создают пользователей динамически и регистрируют
 * их в allowlist во время выполнения. Функция вызывается только в ветке
 * ALLOW_DEV_AUTH (dev/test) — в production ALLOW_DEV_AUTH всегда false,
 * mock-токены сюда не доходят.
 */
export function devUserAllowlist(): ReadonlySet<string> {
  const raw = process.env.DEV_AUTH_USER_ALLOWLIST;
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

/**
 * В development можно временно сгенерировать эфемерный секрет,
 * чтобы не блокировать локальный запуск.
 *
 * В production секреты обязаны быть заданы явно.
 */
function secretEnv(name: string): string {
  const value = process.env[name];

  if (value) {
    if (isProduction && name === "JWT_SECRET" && value.length < 32) {
      throw new Error(
        `[env] ${name} must be at least 32 characters long in production.`
      );
    }
    return value;
  }

  if (isProduction) {
    failMissingEnv(name);
  }

  console.warn(
    `[env] ${name} is not set. Generated ephemeral development secret. ` +
      `Do not use this in production.`
  );

  return randomBytes(32).toString("hex");
}

export const env = {
  NODE_ENV,
  isProduction,

  PORT: isProduction
    ? positiveIntEnv("PORT", 3000)
    : positiveIntEnv("BACKEND_PORT", 3001),

  /**
   * DATABASE_URL обязателен всегда.
   * Никакого fallback быть не должно.
   */
  DATABASE_URL: requiredEnv("DATABASE_URL"),

  /**
   * Секреты.
   * В production обязательны.
   * В development могут быть эфемерными, если не заданы.
   */
  JWT_SECRET: secretEnv("JWT_SECRET"),

  /**
   * Токен Telegram-бота (выдаёт @BotFather). Нужен для серверной
   * валидации initData Telegram Mini Apps (HMAC-SHA256, @telegram-apps/
   * init-data-node). Опционален: пустое значение = Telegram-auth выключен
   * (POST /auth/telegram отвечает 503). В dev/test при ALLOW_DEV_AUTH
   * без токена работает dev-bypass
   * (hash=dev-hash, см. auth/telegramSign.ts). Секрет: не логировать,
   * не коммитить. Намеренно НЕ secretEnv: эфемерный токен бессмыслен,
   * роут должен быть закрыт, пока токен не задан (как ADMIN_TOKEN).
   */
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",

  /**
   * TTL initData в секундах: сколько подписанная Telegram строка считается
   * свежей (анти-replay). Дефолт 1 час (не платформенные сутки): initData
   * может быть украдена и переиспользована в окне валидности; длинную
   * сессию держит наша JWT refresh-ротация, а не initData.
   */
  TG_INIT_DATA_TTL_SECONDS: positiveIntEnv("TG_INIT_DATA_TTL_SECONDS", 3600),

  /**
   * Rate limit Telegram-auth.
   */
  TG_AUTH_RATE_WINDOW_MS: positiveIntEnv("TG_AUTH_RATE_WINDOW_MS", 5 * 60 * 1000),
  TG_AUTH_RATE_MAX: positiveIntEnv("TG_AUTH_RATE_MAX", devRateMax(5)),

  /**
   * Хосты Telegram-фронта (comma-separated): запросы со Host из
   * этого списка получают telegram-app/dist (см. static в app.ts).
   * Пусто = приложение отвечает 404.
   * Пример: "tg-edem.binetc.fun". Reverse proxy не трогаем — маршрутизация
   * по Host на уровне приложения; CORS не нужен (same-origin через прокси).
   */
  TELEGRAM_HOSTS: (process.env.TELEGRAM_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Kill-switch TG-доставки уведомлений (tg-migration-15): при false
   * deliverTelegramNotification фиксирует пропуск в логе, inbox-записи
   * продолжают создаваться. Дефолт true — доставка включена.
   */
  TELEGRAM_DELIVERY_ENABLED: boolEnv("TELEGRAM_DELIVERY_ENABLED", true),

  /**
   * Секрет Telegram-бота для webhook (bot-api-approval-package §4.2):
   * случайная строка в path POST /bot/webhook/:secret. Выдаётся вместе
   * с токеном бота, ротация — перевыпуском URL вебхука. В production
   * обязателен, в dev эфемерный (secretEnv).
   */
  TELEGRAM_WEBHOOK_SECRET: secretEnv("TELEGRAM_WEBHOOK_SECRET"),

  /**
   * Интервал опроса outbox-таблицы NotificationDelivery диспетчером
   * (в миллисекундах). Дефолт 15 секунд — консервативный поллинг,
   * без отдельного процесса-воркера на shadow-этапе.
   */
  TG_NOTIFICATION_DISPATCH_INTERVAL_MS: positiveIntEnv(
    "TG_NOTIFICATION_DISPATCH_INTERVAL_MS",
    15 * 1000,
  ),

  /**
   * Максимум попыток обработки одной outbox-записи (включая первую):
   * ретраи с бэкоффом, после исчерпания — status=failed.
   */
  TG_NOTIFICATION_MAX_RETRIES: positiveIntEnv("TG_NOTIFICATION_MAX_RETRIES", 3),

  /**
   * Per-user rate limit диспетчера: не более N доставок в окно
   * (бот-api-approval-package §4: ≤5/час, критичные вне лимита —
   * но ≤1/5мин на тип). Окно в миллисекундах, дефолт 1 час.
   */
  TG_NOTIFICATION_USER_RATE_WINDOW_MS: positiveIntEnv(
    "TG_NOTIFICATION_USER_RATE_WINDOW_MS",
    60 * 60 * 1000,
  ),
  TG_NOTIFICATION_USER_RATE_MAX: positiveIntEnv("TG_NOTIFICATION_USER_RATE_MAX", 5),

  /**
   * Дедуп-пауза на тип для критичных: повторный критичный того же типа
   * тому же пользователю не чаще одного раза в это окно (мс).
   */
  TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS: positiveIntEnv(
    "TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS",
    5 * 60 * 1000,
  ),

  /**
   * Размер пачки outbox-записей, забираемой диспетчером за один тик.
   */
  TG_NOTIFICATION_DISPATCH_BATCH_SIZE: positiveIntEnv("TG_NOTIFICATION_DISPATCH_BATCH_SIZE", 50),

  /**
   * Окно дедупликации идентичных TG-уведомлений в миллисекундах:
   * повтор того же события (user+type+title+body) внутри окна не
   * создаёт вторую inbox-запись. Легитимные разные события отличаются
   * текстом и не подавляются. Дефолт 60 секунд.
   */
  TG_NOTIFICATION_DEDUPE_WINDOW_MS: positiveIntEnv(
    "TG_NOTIFICATION_DEDUPE_WINDOW_MS",
    60 * 1000,
  ),

  /**
   * CORS.
   * В production список origin обязателен.
   */
  CORS_ORIGINS: isProduction
    ? requiredEnv("CORS_ORIGINS")
    : process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001",

  /**
   * Dev-имитация разрешена только в development/test (если ALLOW_DEV_AUTH=true).
   * В production всегда false.
   */
  ALLOW_DEV_AUTH: (() => {
    if (isProduction) return false;
    if (process.env.VITEST) return true;
    return process.env.ALLOW_DEV_AUTH === "true";
  })(),

  /**
   * JWT TTL.
   */
  JWT_ACCESS_TTL_SECONDS: positiveIntEnv("JWT_ACCESS_TTL_SECONDS", 15 * 60),
  JWT_REFRESH_TTL_SECONDS: positiveIntEnv("JWT_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60),

  /**
   * TTL dev mock-токенов (mock-access-token-<id>, mock-refresh-token-<id>) в секундах.
   * Короткий намеренно: mock-токен — одноразовый dev-артефакт, а не сессия.
   */
  DEV_MOCK_TOKEN_TTL_SECONDS: positiveIntEnv("DEV_MOCK_TOKEN_TTL_SECONDS", 15 * 60),

  /**
   * Если приложение стоит за доверенным прокси (Nginx), прокси
   * перезаписывает X-Real-IP / X-Forwarded-For, и им можно доверять.
   * Иначе используем IP из TCP-сокета (неподделываемый).
   */
  TRUST_PROXY: boolEnv("TRUST_PROXY", false),

  /**
   * Rate limit для auth (раздельные лимитеры на каждый endpoint).
   */
  REFRESH_RATE_WINDOW_MS: positiveIntEnv("REFRESH_RATE_WINDOW_MS", 10 * 60 * 1000),
  REFRESH_RATE_MAX: positiveIntEnv("REFRESH_RATE_MAX", devRateMax(10)),

  /**
   * Rate limits (IP-based).
   */
  PUBLIC_READ_RATE_WINDOW_MS: positiveIntEnv("PUBLIC_READ_RATE_WINDOW_MS", 60 * 1000),
  PUBLIC_READ_RATE_MAX: positiveIntEnv("PUBLIC_READ_RATE_MAX", devRateMax(100)),
  MUTATION_RATE_WINDOW_MS: positiveIntEnv("MUTATION_RATE_WINDOW_MS", 60 * 1000),
  MUTATION_RATE_MAX: positiveIntEnv("MUTATION_RATE_MAX", devRateMax(30)),

  /**
   * Rate limits (user-based): «дорогие» действия по аккаунту.
   */
  CREATE_TRIP_RATE_WINDOW_MS: positiveIntEnv("CREATE_TRIP_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  CREATE_TRIP_RATE_MAX: positiveIntEnv("CREATE_TRIP_RATE_MAX", devRateMax(10)),
  CANCEL_TRIP_RATE_WINDOW_MS: positiveIntEnv("CANCEL_TRIP_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  CANCEL_TRIP_RATE_MAX: positiveIntEnv("CANCEL_TRIP_RATE_MAX", devRateMax(20)),
  CREATE_BOOKING_RATE_WINDOW_MS: positiveIntEnv("CREATE_BOOKING_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  CREATE_BOOKING_RATE_MAX: positiveIntEnv("CREATE_BOOKING_RATE_MAX", devRateMax(20)),
  CANCEL_BOOKING_RATE_WINDOW_MS: positiveIntEnv("CANCEL_BOOKING_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  CANCEL_BOOKING_RATE_MAX: positiveIntEnv("CANCEL_BOOKING_RATE_MAX", devRateMax(20)),
  /** Завершение поездок водителем (PATCH /trips/:id/complete), 20 в сутки. */
  COMPLETE_TRIP_RATE_WINDOW_MS: positiveIntEnv("COMPLETE_TRIP_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  COMPLETE_TRIP_RATE_MAX: positiveIntEnv("COMPLETE_TRIP_RATE_MAX", devRateMax(20)),

  /**
   * Rate limits (user-based): частые, но лёгкие действия по аккаунту
   * (профиль, машина, уведомления, личные списки). Окно — сутки.
   */
  PROFILE_UPDATE_RATE_WINDOW_MS: positiveIntEnv("PROFILE_UPDATE_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  PROFILE_UPDATE_RATE_MAX: positiveIntEnv("PROFILE_UPDATE_RATE_MAX", devRateMax(50)),
  NOTIFICATION_READ_RATE_WINDOW_MS: positiveIntEnv("NOTIFICATION_READ_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  NOTIFICATION_READ_RATE_MAX: positiveIntEnv("NOTIFICATION_READ_RATE_MAX", devRateMax(100)),
  REVIEWS_READ_RATE_WINDOW_MS: positiveIntEnv("REVIEWS_READ_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  REVIEWS_READ_RATE_MAX: positiveIntEnv("REVIEWS_READ_RATE_MAX", devRateMax(100)),
  FEEDBACK_READ_RATE_WINDOW_MS: positiveIntEnv("FEEDBACK_READ_RATE_WINDOW_MS", 24 * 60 * 60 * 1000),
  FEEDBACK_READ_RATE_MAX: positiveIntEnv("FEEDBACK_READ_RATE_MAX", devRateMax(100)),

  LOG_LEVEL:
    process.env.LOG_LEVEL ||
    (isProduction ? "info" : "debug"),

  SENTRY_DSN: process.env.SENTRY_DSN || "",

  /**
   * Bearer-токен для служебного endpoint /metrics.
   * В production отсутствие токена не открывает endpoint публично.
   */
  METRICS_TOKEN: process.env.METRICS_TOKEN || "",

  /**
   * Статичный токен админ-панели (тело POST /api/v1/admin/auth/login).
   * Пустое значение = админ-API выключено: все запросы получают 403.
   * Намеренно НЕ secretEnv: эфемерный dev-секрет недопустим,
   * панель закрыта по умолчанию в любой среде, пока токен не задан.
   */
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",

  /**
   * TTL JWT админ-панели (httpOnly cookie edem_admin_jwt).
   * По умолчанию 12 часов; refresh-токенов нет — по истечении повторный логин.
   */
  ADMIN_JWT_TTL_SECONDS: positiveIntEnv("ADMIN_JWT_TTL_SECONDS", 12 * 60 * 60),

  /**
   * Rate limit логина админ-панели (IP-based, анти-брутфорс).
   */
  ADMIN_LOGIN_RATE_WINDOW_MS: positiveIntEnv(
    "ADMIN_LOGIN_RATE_WINDOW_MS",
    5 * 60 * 1000
  ),
  ADMIN_LOGIN_RATE_MAX: positiveIntEnv("ADMIN_LOGIN_RATE_MAX", devRateMax(5)),

  /**
   * Rate limit GET-эндпоинтов админ-панели (IP-based).
   * Выше публичного read-лимитера: UI админки отдаёт запросами пачками
   * (дашборд + списки + пагинация).
   */
  ADMIN_READ_RATE_WINDOW_MS: positiveIntEnv("ADMIN_READ_RATE_WINDOW_MS", 60 * 1000),
  ADMIN_READ_RATE_MAX: positiveIntEnv("ADMIN_READ_RATE_MAX", devRateMax(300)),
};
