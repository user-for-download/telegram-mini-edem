// backend/src/middleware/rateLimit.ts
import type { Context, Env, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ERROR_CODES } from "../errors.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { AuthUser } from "../auth/middleware.js";

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

interface RateBucket {
  timestamps: number[];
}

/**
 * Простой in-memory rate limiter.
 *
 * Подходит для одного инстанса.
 * Для production с несколькими инстансами лучше использовать Redis.
 *
 * Ключ строится по IP клиента:
 * - за доверенным прокси (env.TRUST_PROXY) — из заголовков X-Real-IP / X-Forwarded-For,
 *   которые прокси перезаписывает (подделать их снаружи нельзя);
 * - при прямом подключении — из TCP-сокета (getConnInfo), неподделываемый.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, bucket] of buckets.entries()) {
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < options.windowMs
      );

      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, options.windowMs);

  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  return async function rateLimiter(c: Context, next: Next) {
    const ip = resolveClientIp(c);

    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();

    const bucket = buckets.get(key) ?? { timestamps: [] };

    bucket.timestamps = bucket.timestamps.filter(
      (timestamp) => now - timestamp < options.windowMs
    );

    if (bucket.timestamps.length >= options.max) {
      return c.json({ code: ERROR_CODES.RATE_LIMITED, message: "Too many requests" }, 429);
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);

    return next();
  };
}

function resolveClientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    // Прокси (Nginx) должен перезаписывать заголовки, а не дополнять:
    //   proxy_set_header X-Real-IP $remote_addr;
    //   proxy_set_header X-Forwarded-For $remote_addr;
    // Иначе левый (первый) хоп в X-Forwarded-For подделывается клиентом.
    return (
      c.req.header("x-real-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown"
    );
  }

  try {
    const connInfo = getConnInfo(c);
    return connInfo.remote.address || "unknown";
  } catch {
    // Фоллбек для сред, где getConnInfo недоступен (например, vitest app.request).
    // X-Forwarded-For без доверенного прокси подделывается клиентом —
    // в production не используем его, иначе лимитер обходится по заголовку.
    if (env.TRUST_PROXY) {
      return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    }
    return "unknown";
  }
}

// ─── Пресеты лимитеров ──────────────────────────────────────────────────────

/**
 * Лимитер для публичных GET-эндпоинтов (поиск, профили, отзывы).
 * 100 запросов в минуту с одного IP (настраивается через ENV).
 */
export const publicReadLimiter = createRateLimiter({
  windowMs: env.PUBLIC_READ_RATE_WINDOW_MS,
  max: env.PUBLIC_READ_RATE_MAX,
  keyPrefix: "public-read",
});

/**
 * Лимитер для мутаций (создание поездок, броней, отзывов).
 * 30 запросов в минуту с одного IP (настраивается через ENV).
 */
export const mutationLimiter = createRateLimiter({
  windowMs: env.MUTATION_RATE_WINDOW_MS,
  max: env.MUTATION_RATE_MAX,
  keyPrefix: "mutation",
});

/**
 * User-based rate limiter: ключ — userId, а не IP.
 *
 * Лимитирует «дорогие» действия по аккаунту (создание поездок, броней,
 * отмены), чтобы нельзя было обойти IP-лимит сменой IP/NAT.
 *
 * Обязательно ставить ПОСЛЕ requireUser: без user в контексте лимитер
 * не работает и выбрасывает ошибку (fail-fast), а не молча пропускает.
 *
 * Память: bucket'ы чистятся лениво при обращении (пустой — удаляется)
 * и периодическим cleanup-таймером (unref — не держит процесс).
 */
export function createUserRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, bucket] of buckets.entries()) {
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < options.windowMs
      );

      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, options.windowMs);

  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  // Generic middleware: Hono выводит Env (включая Path) из роутера,
  // поэтому у handler'ов после лимитера сохраняется типизация param().
  return async function userRateLimiter<
    E extends Env & { Variables: { user?: AuthUser } },
    P extends string = string,
  >(c: Context<E, P>, next: Next): Promise<Response | void> {
    const user = c.get("user");
    if (!user) {
      throw new Error("userRateLimiter must run after requireUser");
    }

    const key = `${options.keyPrefix}:${user.id}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (bucket) {
      // Lazy cleanup: выкидываем протухшие метки сразу, пустой bucket удаляем.
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < options.windowMs
      );
      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
        bucket = undefined;
      }
    }

    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }

    if (bucket.timestamps.length >= options.max) {
      const oldestTimestamp = bucket.timestamps[0];
      const retryAfterMs = Math.max(
        1,
        options.windowMs - (now - oldestTimestamp)
      );

      logger.warn(
        `[Rate Limit] user ${user.id} exceeded ${options.keyPrefix} (${options.max}/${options.windowMs}ms)`
      );

      c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));

      return c.json(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Лимит действий исчерпан. Попробуйте через ${Math.ceil(retryAfterMs / 1000 / 60)} мин.`,
          retryAfterMs,
        },
        429
      );
    }

    // В single-threaded Node.js между filter() и push() нет await —
    // другой запрос для этого же ключа не может вклиниться (нет гонки).
    bucket.timestamps.push(now);

    return next();
  };
}

// ─── Пресеты user-based лимитеров ─────────────────────────────────────────

/** Водитель: создание поездок, 10 в сутки (настраивается через ENV). */
export const createTripLimiter = createUserRateLimiter({
  windowMs: env.CREATE_TRIP_RATE_WINDOW_MS,
  max: env.CREATE_TRIP_RATE_MAX,
  keyPrefix: "driver-create-trip",
});

/** Водитель: отмена поездок, 20 в сутки (настраивается через ENV). */
export const cancelTripLimiter = createUserRateLimiter({
  windowMs: env.CANCEL_TRIP_RATE_WINDOW_MS,
  max: env.CANCEL_TRIP_RATE_MAX,
  keyPrefix: "driver-cancel-trip",
});

/** Пассажир: создание броней, 20 в сутки (настраивается через ENV). */
export const createBookingLimiter = createUserRateLimiter({
  windowMs: env.CREATE_BOOKING_RATE_WINDOW_MS,
  max: env.CREATE_BOOKING_RATE_MAX,
  keyPrefix: "passenger-create-booking",
});

/** Пассажир: отмена броней, 20 в сутки (настраивается через ENV). */
export const cancelBookingLimiter = createUserRateLimiter({
  windowMs: env.CANCEL_BOOKING_RATE_WINDOW_MS,
  max: env.CANCEL_BOOKING_RATE_MAX,
  keyPrefix: "passenger-cancel-booking",
});

/** Водитель: завершение поездок, 20 в сутки (настраивается через ENV). */
export const completeTripLimiter = createUserRateLimiter({
  windowMs: env.COMPLETE_TRIP_RATE_WINDOW_MS,
  max: env.COMPLETE_TRIP_RATE_MAX,
  keyPrefix: "driver-complete-trip",
});

/**
 * Пользователь: редактирование профиля и машины
 * (PATCH /users/me, POST|PATCH /users/me/car), 50 в сутки.
 */
export const profileUpdateLimiter = createUserRateLimiter({
  windowMs: env.PROFILE_UPDATE_RATE_WINDOW_MS,
  max: env.PROFILE_UPDATE_RATE_MAX,
  keyPrefix: "user-profile-update",
});

/**
 * Пользователь: отметки о прочтении уведомлений
 * (PATCH /notifications/:id/read, PATCH /notifications/read-all), 100 в сутки.
 */
export const notificationReadLimiter = createUserRateLimiter({
  windowMs: env.NOTIFICATION_READ_RATE_WINDOW_MS,
  max: env.NOTIFICATION_READ_RATE_MAX,
  keyPrefix: "user-notification-read",
});

/** Пользователь: личные списки отзывов (GET /reviews/my, /available-trips), 100 в сутки. */
export const reviewsReadLimiter = createUserRateLimiter({
  windowMs: env.REVIEWS_READ_RATE_WINDOW_MS,
  max: env.REVIEWS_READ_RATE_MAX,
  keyPrefix: "user-reviews-read",
});

/** Пользователь: список своих обращений (GET /feedback), 100 в сутки. */
export const feedbackReadLimiter = createUserRateLimiter({
  windowMs: env.FEEDBACK_READ_RATE_WINDOW_MS,
  max: env.FEEDBACK_READ_RATE_MAX,
  keyPrefix: "user-feedback-read",
});

/**
 * GET-эндпоинты админ-панели: IP-based, лимит выше публичного read-лимитера
 * (300/мин против 100/мин) — UI админки отдаёт запросами пачками
 * (дашборд + списки + пагинация). Ставится после adminGuard:
 * неавторизованные запросы бюджет не тратят.
 */
export const adminReadLimiter = createRateLimiter({
  windowMs: env.ADMIN_READ_RATE_WINDOW_MS,
  max: env.ADMIN_READ_RATE_MAX,
  keyPrefix: "admin-read",
});
