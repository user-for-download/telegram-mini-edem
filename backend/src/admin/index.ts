// backend/src/admin/index.ts
// Endpoint'ы админ-API (/api/v1/admin): авторизация (login/session/logout),
// чтение и модерация (ban/unban, отмена поездок, статусы броней, удаление
// отзывов). Доступ закрыт adminGuard (JWT из httpOnly cookie edem_admin_jwt);
// монтируется в app.ts отдельно.
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import {
  ACTIVE_BOOKING_STATUSES,
  adminBookingStatusBodySchema,
  adminBookingsQuerySchema,
  adminCitiesQuerySchema,
  adminFeedbackQuerySchema,
  adminLoginBodySchema,
  adminReviewsQuerySchema,
  adminTripsQuerySchema,
  adminUsersQuerySchema,
  banUserBodySchema,
  cityNameBodySchema,
  feedbackReplyBodySchema,
  isActiveBookingStatus,
  paginatedCitiesResponseSchema,
} from "@edem/contracts";
import type {
  AdminDashboardDto,
  AdminLoginResponse,
  AdminPaginatedBookings,
  AdminPaginatedFeedback,
  AdminPaginatedReviews,
  AdminPaginatedTrips,
  AdminPaginatedUsers,
  AdminSessionResponse,
  AdminSettingsDto,
} from "@edem/contracts";
import { cityNameNormalized } from "@edem/contracts";
import { db } from "../db.js";
import { env } from "../env.js";
import { ERROR_CODES } from "../errors.js";
import { getSanitizedBody, sanitizeValue } from "../middleware/sanitize.js";
import {
  createRateLimiter,
  mutationLimiter,
  adminReadLimiter,
} from "../middleware/rateLimit.js";
import {
  signAdminAccessToken,
  verifyAdminAccessToken,
} from "../auth/tokens.js";
import { wsManager } from "../ws/manager.js";
import { tokensEqual } from "../utils/timingSafeEqual.js";
import { getUniqueConstraintName } from "../utils/prisma-errors.js";
import { recomputeUserRating } from "../reviews/rating.js";
import { createNotification } from "../services/notification.service.js";
import { getTelegramDeliveryMetrics } from "../services/telegramMetrics.js";
import { logBusinessEvent } from "../logger/business.js";
import { logger } from "../logger.js";
import { ADMIN_COOKIE_NAME, adminGuard } from "./guard.js";
import {
  serializeAdminBooking,
  serializeAdminFeedback,
  serializeAdminReview,
  serializeAdminTrip,
  serializeAdminUser,
} from "./serializers.js";
import { serializeAdminCity } from "../cities/serializers.js";
import {
  decrementCityTripsCount,
  recomputeCityTripsCount,
} from "../cities/counters.js";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export const adminRouter = new Hono();

/**
 * Secure-флаг cookie админки.
 *
 * За reverse-proxy ориентируемся на X-Forwarded-Proto (наш nginx для
 * админки перезаписывает его, см. webapp/nginx.conf), чтобы логин работал
 * и по HTTP-домену без TLS. Без заголовка — консервативно: isProduction.
 *
 * Подделка заголовка прямым клиентом (минуя nginx) опасна только для него
 * самого: «http» снимает Secure с его же cookie, «https» ломает его же
 * логин по HTTP. Чужую сессию это не затрагивает.
 */
function resolveCookieSecure(c: Context): boolean {
  const proto = c.req
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (proto === "https") return true;
  if (proto === "http") return false;
  return env.isProduction;
}

/**
 * Анти-брутфорс логина: несколько попыток в окно с одного IP.
 * IP-based (не user-based): субъекта авторизации до логина нет.
 */
const adminLoginLimiter = createRateLimiter({
  windowMs: env.ADMIN_LOGIN_RATE_WINDOW_MS,
  max: env.ADMIN_LOGIN_RATE_MAX,
  keyPrefix: "admin-login",
});

/**
 * POST /auth/login — вход по статичному ADMIN_TOKEN.
 *
 * Успех: httpOnly cookie edem_admin_jwt с JWT (type=admin-access, sub=admin)
 * и expiresAt в теле. Ошибка токена — 401; ADMIN_TOKEN не задан — 403
 * (панель выключена по умолчанию).
 */
adminRouter.post("/auth/login", adminLoginLimiter, async (c) => {
  if (!env.ADMIN_TOKEN) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Admin access disabled" },
      403,
    );
  }

  const body = await getSanitizedBody(c);
  const parseResult = adminLoginBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid payload" },
      400,
    );
  }

  if (!tokensEqual(parseResult.data.token, env.ADMIN_TOKEN)) {
    return c.json(
      { code: ERROR_CODES.UNAUTHORIZED, message: "Invalid admin token" },
      401,
    );
  }

  const { token, expiresAt } = await signAdminAccessToken();

  setCookie(c, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: resolveCookieSecure(c),
    path: "/",
    maxAge: env.ADMIN_JWT_TTL_SECONDS,
  });

  const payload: AdminLoginResponse = { expiresAt };
  return c.json(payload);
});

/**
 * GET /auth/session — состояние сессии для фронта.
 *
 * Всегда 200: httpOnly cookie недоступен JS, фронт опрашивает этот ресурс
 * при загрузке и после 401 от других endpoint'ов.
 */
adminRouter.get("/auth/session", adminReadLimiter, async (c) => {
  const notAuthenticated: AdminSessionResponse = {
    authenticated: false,
    expiresAt: null,
  };

  if (!env.ADMIN_TOKEN) {
    return c.json(notAuthenticated);
  }

  const token = getCookie(c, ADMIN_COOKIE_NAME);
  if (!token) {
    return c.json(notAuthenticated);
  }

  try {
    const claims = await verifyAdminAccessToken(token);
    const payload: AdminSessionResponse = {
      authenticated: true,
      expiresAt: claims.expiresAt,
    };
    return c.json(payload);
  } catch {
    return c.json(notAuthenticated);
  }
});

/**
 * POST /auth/logout — очистка cookie. Идемпотентно: без cookie тоже ок.
 * JWT stateless — серверного отзыва нет, доступ прекращается удалением cookie.
 */
adminRouter.post("/auth/logout", async (c) => {
  deleteCookie(c, ADMIN_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

adminRouter.use("*", adminGuard);

/**
 * getSanitizedBody читает только JSON-тело и для GET не подходит:
 * собираем объект из query-параметров и чистим строки от HTML.
 */
function getSanitizedQuery(c: Context): Record<string, unknown> | null {
  const params = new URL(c.req.url).searchParams;
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();

  for (const [key, value] of params) {
    // URLSearchParams preserves duplicate keys; rejecting them prevents a
    // proxy/client disagreement about which value reaches the contract.
    if (keys.has(key)) return null;
    keys.add(key);
    entries.push([key, sanitizeValue(value)]);
  }

  return Object.fromEntries(entries);
}

function invalidQueryResponse(c: Context) {
  return c.json(
    { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid query" },
    400,
  );
}

/**
 * Сводные метрики для дашборда.
 */
adminRouter.get("/dashboard", adminReadLimiter, async (c) => {
  const weekAgo = new Date(Date.now() - SEVEN_DAYS_MS);

  const [
    totalUsers,
    totalTrips,
    activeTrips,
    totalBookings,
    totalReviews,
    newUsersLast7Days,
  ] = await Promise.all([
    db.user.count(),
    db.trip.count(),
    db.trip.count({ where: { status: "active" } }),
    db.booking.count(),
    db.review.count(),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);

  const payload: AdminDashboardDto = {
    totalUsers,
    totalTrips,
    activeTrips,
    totalBookings,
    totalReviews,
    newUsersLast7Days,
  };

  return c.json(payload);
});

/**
 * Список пользователей с поиском по имени и пагинацией.
 */
adminRouter.get("/users", adminReadLimiter, async (c) => {
  const parseResult = adminUsersQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parseResult.success) {
    return invalidQueryResponse(c);
  }

  const query = parseResult.data;
  const where: Prisma.UserWhereInput = query.q
    ? { name: { contains: query.q, mode: "insensitive" } }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.user.count({ where }),
  ]);

  const payload: AdminPaginatedUsers = {
    items: users.map(serializeAdminUser),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };

  return c.json(payload);
});

/**
 * Список поездок с фильтром по статусу и пагинацией.
 */
adminRouter.get("/trips", adminReadLimiter, async (c) => {
  const parseResult = adminTripsQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parseResult.success) {
    return invalidQueryResponse(c);
  }

  const query = parseResult.data;
  const where: Prisma.TripWhereInput = query.status
    ? { status: query.status }
    : {};

  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where,
      include: { driver: true },
      orderBy: { departureAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.trip.count({ where }),
  ]);

  const payload: AdminPaginatedTrips = {
    items: trips.map(serializeAdminTrip),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };

  return c.json(payload);
});

/**
 * Список бронирований с фильтром по статусу и пагинацией.
 */
adminRouter.get("/bookings", adminReadLimiter, async (c) => {
  const parseResult = adminBookingsQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parseResult.success) {
    return invalidQueryResponse(c);
  }

  const query = parseResult.data;
  const where: Prisma.BookingWhereInput = query.status
    ? { status: query.status }
    : {};

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: { trip: true, passenger: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.booking.count({ where }),
  ]);

  const payload: AdminPaginatedBookings = {
    items: bookings.map(serializeAdminBooking),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };

  return c.json(payload);
});

/**
 * Список отзывов с пагинацией (автор и получатель).
 * Необязательный фильтр ?status=pending|published|rejected.
 */
adminRouter.get("/reviews", adminReadLimiter, async (c) => {
  const parseResult = adminReviewsQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parseResult.success) {
    return invalidQueryResponse(c);
  }

  const query = parseResult.data;
  const where: Prisma.ReviewWhereInput = query.status
    ? { status: query.status }
    : {};

  const [reviews, total] = await Promise.all([
    db.review.findMany({
      where,
      include: { author: true, targetUser: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.review.count({ where }),
  ]);

  const payload: AdminPaginatedReviews = {
    items: reviews.map(serializeAdminReview),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };

  return c.json(payload);
});

/**
 * GET /feedback — обращения пользователей в поддержку (offset-пагинация,
 * новые первыми). Read-only.
 */
adminRouter.get("/feedback", adminReadLimiter, async (c) => {
  const parseResult = adminFeedbackQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parseResult.success) {
    return invalidQueryResponse(c);
  }

  const query = parseResult.data;

  const [feedbacks, total] = await Promise.all([
    db.feedback.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.feedback.count(),
  ]);

  const payload: AdminPaginatedFeedback = {
    items: feedbacks.map(serializeAdminFeedback),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };

  return c.json(payload);
});

/**
 * GET /feedback/:id — детальная карточка обращения (полный текст, ответ
 * админа если есть). 404 для несуществующего id.
 */
adminRouter.get("/feedback/:id", adminReadLimiter, async (c) => {
  const id = c.req.param("id");
  const feedback = await db.feedback.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!feedback) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Feedback not found" },
      404,
    );
  }
  return c.json(serializeAdminFeedback(feedback));
});

/**
 * POST /feedback/:id/reply — первичный ответ админа. Создаёт in-app
 * уведомление пользователю. 404 если обращение не найдено; 400 если
 * уже есть ответ (используйте PUT для редактирования).
 */
adminRouter.post("/feedback/:id/reply", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const body = await getSanitizedBody(c);
  const parseResult = feedbackReplyBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid payload",
        errors: z.formatError(parseResult.error),
      },
      400,
    );
  }

  const existing = await db.feedback.findUnique({ where: { id } });
  if (!existing) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Feedback not found" },
      404,
    );
  }
  if (existing.reply !== null) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Reply already exists; use PUT to update",
      },
      400,
    );
  }

  const now = new Date();
  const updated = await db.feedback.update({
    where: { id },
    data: { reply: parseResult.data.reply, repliedAt: now },
    include: { user: true },
  });

  // In-app уведомление: «feedback_replied» — не критичный тип, подчиняется
  // тумблеру notificationsEnabled пользователя (createNotification проверяет
  // его внутри). Глубокая ссылка ведёт в раздел «Мои обращения» мини-аппа.
  await createNotification(
    updated.userId,
    "feedback_replied",
    "Ответ поддержки",
    truncateForNotification(updated.reply ?? ""),
    "/profile?panel=support",
  );

  logBusinessEvent("feedback.replied", {
    feedbackId: updated.id,
    userId: updated.userId,
  });

  return c.json(serializeAdminFeedback(updated));
});

/**
 * PUT /feedback/:id/reply — изменить/перезаписать существующий ответ. Не
 * двигает `repliedAt` (аудит «когда был дан ответ»). 404 если обращение
 * не найдено; 400 если ответа ещё нет (используйте POST).
 */
adminRouter.put("/feedback/:id/reply", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const body = await getSanitizedBody(c);
  const parseResult = feedbackReplyBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid payload",
        errors: z.formatError(parseResult.error),
      },
      400,
    );
  }

  const existing = await db.feedback.findUnique({ where: { id } });
  if (!existing) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Feedback not found" },
      404,
    );
  }
  if (existing.reply === null) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "No reply to update; use POST to create",
      },
      400,
    );
  }

  const updated = await db.feedback.update({
    where: { id },
    data: { reply: parseResult.data.reply },
    include: { user: true },
  });

  logBusinessEvent("feedback.reply_updated", {
    feedbackId: updated.id,
    userId: updated.userId,
  });

  return c.json(serializeAdminFeedback(updated));
});

/**
 * Truncate уведомления до 200 символов с многоточием, чтобы не раздувать
 * строку в Notification.body. Длинные ответы открываются по тапу целиком.
 */
function truncateForNotification(text: string): string {
  const MAX = 200;
  if (text.length <= MAX) return text;
  return text.slice(0, MAX - 1) + "…";
}

/**
 * Read-only снимок текущих rate-limit'ов и флагов из env. Записи нет.
 */
adminRouter.get("/settings", adminReadLimiter, async (c) => {
  const payload: AdminSettingsDto = {
    createTripRateMax: env.CREATE_TRIP_RATE_MAX,
    cancelTripRateMax: env.CANCEL_TRIP_RATE_MAX,
    createBookingRateMax: env.CREATE_BOOKING_RATE_MAX,
    cancelBookingRateMax: env.CANCEL_BOOKING_RATE_MAX,
    publicReadRateMax: env.PUBLIC_READ_RATE_MAX,
    mutationRateMax: env.MUTATION_RATE_MAX,
    allowDevAuth: env.ALLOW_DEV_AUTH,
    isProduction: env.isProduction,
    trustProxy: env.TRUST_PROXY,
  };

  return c.json(payload);
});

/**
 * Бан пользователя: устанавливаем bannedAt и обязательную причину (banReason).
 * Тело валидируется контрактом — пустая/пробельная/слишком длинная причина
 * (или лишние поля) → 400. Идемпотентно: повторный бан просто обновляет
 * метку времени и перезаписывает причину. Открытые WS-соединения закрываем
 * сразу (код 4403). Поездки пользователя при этом НЕ отменяем (осознанно).
 */
adminRouter.patch("/users/:id/ban", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const body = await getSanitizedBody(c);
  const parseResult = banUserBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid payload",
        errors: z.formatError(parseResult.error),
      },
      400,
    );
  }

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  const updated = await db.user.update({
    where: { id },
    data: { bannedAt: new Date(), banReason: parseResult.data.reason },
  });

  // Уже установленные WS-сессии не знают о бане до истечения access-токена —
  // закрываем их немедленно.
  wsManager.closeUserConnections(updated.id, 4403, "Account is banned");

  return c.json(serializeAdminUser(updated));
});

/**
 * Разбан пользователя: очищаем и bannedAt, и banReason.
 */
adminRouter.patch("/users/:id/unban", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  const updated = await db.user.update({
    where: { id },
    data: { bannedAt: null, banReason: null },
  });

  return c.json(serializeAdminUser(updated));
});

/**
 * Сброс онбординга пользователя: обнуляем onboardingVersion и момент
 * акцепта (consentAcceptedAt) — при следующем запуске пользователь снова
 * увидит слайды и экран согласия (повторный акцепт новой редакции).
 * Идемпотентно: сброс уже пустого флага просто возвращает пользователя.
 */
adminRouter.patch("/users/:id/onboarding-reset", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  const updated = await db.user.update({
    where: { id },
    data: { onboardingVersion: null, consentAcceptedAt: null },
  });

  return c.json(serializeAdminUser(updated));
});

/**
 * Ручной стоп Telegram-уведомлений пользователя (bot-api shadow,
 * approval-package §4.6): обнуляет согласие (tgChatJoinedAt) и гасит
 * его pending-задачи в outbox как skipped/admin_stopped. Следующий тик
 * диспетчера увидит чат=null и пропустит остальные — стоп мгновенный,
 * без кэша. Идемпотентно: повторный стоп на пустом согласии — 200.
 */
adminRouter.patch("/users/:id/telegram-stop", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  const hadConsent = user.tgChatJoinedAt != null;

  await db.user.update({
    where: { id },
    data: { tgChatJoinedAt: null },
  });

  const cancelled = await db.notificationDelivery.updateMany({
    where: { userId: id, status: { in: ["pending", "processing"] } },
    data: { status: "skipped", error: "admin_stopped" },
  });

  logger.info(
    { userId: id, cancelled: cancelled.count, hadConsent },
    "tg_admin_stop",
  );

  return c.json({
    success: true,
    hadConsent,
    cancelledDeliveries: cancelled.count,
  });
});

/**
 * JSON-агрегаты Telegram-outbox для админ-панели: те же цифры, что в
 * /metrics (Prometheus), но структурированные. Без PII — только counts.
 */
adminRouter.get("/telegram/metrics", adminReadLimiter, async (c) => {
  const metrics = await getTelegramDeliveryMetrics();
  return c.json(metrics);
});

/**
 * Отмена поездки администратором.
 *
 * Полный жизненный цикл — как в водительской отмене (trips/index.ts):
 * - все pending/confirmed брони становятся cancelled (с аудитом);
 * - seatsAvailable обнуляется — поездка недоступна для бронирования;
 * - счётчики городов декрементируются в той же транзакции (F17).
 * Завершённые и уже отменённые поездки отменить нельзя (409).
 * Уведомления пассажирам — ВНЕ транзакции, после успешного коммита.
 *
 * TOCTOU: загрузка поездки и проверка статуса выполняются ВНУТРИ
 * Serializable-транзакции — параллельные отмены (админ/водитель) не могут
 * дважды декрементировать счётчики городов (F17) или дважды отменить
 * брони: конфликтная транзакция получит P2034 и ответит 409.
 */
adminRouter.patch("/trips/:id/cancel", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  type CancelResult =
    | {
        kind: "ok";
        trip: Prisma.TripGetPayload<{ include: { driver: true } }>;
        passengerIds: string[];
      }
    | { kind: "not_found" }
    | { kind: "not_active" };

  let result: CancelResult;
  try {
    result = await db.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id },
          include: { driver: true },
        });
        if (!trip) {
          return { kind: "not_found" as const };
        }

        // Завершённая поездка — свершившийся факт (отзывы, история), отмена
        // задним числом запрещена; повторная отмена тоже не допускается.
        if (trip.status === "completed" || trip.status === "cancelled") {
          return { kind: "not_active" as const };
        }

        // Пассажиров собираем ДО updateMany: после перевода броней
        // в cancelled выборка по активным статусам вернёт пустой массив.
        const activeBookings = await tx.booking.findMany({
          where: { tripId: trip.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
          select: { passengerId: true },
        });

        // Каскад: активные брони отменяются с аудитом админ-действия.
        // Без этого отменённая поездка держала бы «живые» брони, которые
        // пассажир не может отменить сам (пассажирский endpoint требует
        // active-поездку) — рассинхрон мест и невозможные статусы.
        await tx.booking.updateMany({
          where: {
            tripId: trip.id,
            status: { in: [...ACTIVE_BOOKING_STATUSES] },
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledByType: "admin",
            cancellationReason: "Trip cancelled by admin",
          },
        });

        // F17: декремент счётчиков городов — в той же транзакции, что и
        // смена статуса. Guarded (tripsCount > 0): счётчик не уходит в минус.
        await decrementCityTripsCount(tx, trip.fromCityId, trip.toCityId);

        const updated = await tx.trip.update({
          where: { id },
          data: {
            status: "cancelled",
            seatsAvailable: 0,
            cancelledAt: new Date(),
            cancelledByType: "admin",
          },
          include: { driver: true },
        });

        return {
          kind: "ok" as const,
          trip: updated,
          passengerIds: Array.from(
            new Set(activeBookings.map((b) => b.passengerId)),
          ),
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    // Serializable: параллельная отмена той же поездки — конфликтная
    // транзакция получает 409, а не двойной декремент счётчиков.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Поездка только что изменилась, попробуйте ещё раз",
        },
        409,
      );
    }
    throw error;
  }

  if (result.kind === "not_found") {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Trip not found" },
      404,
    );
  }
  if (result.kind === "not_active") {
    return c.json(
      {
        code: ERROR_CODES.TRIP_NOT_ACTIVE,
        message: "Trip is already completed or cancelled",
      },
      409,
    );
  }

  const { trip, passengerIds } = result;

  // Персистентные уведомления + WS-события пассажирам — ВНЕ транзакции
  // (паттерн водительской отмены). createNotification глотает ошибки
  // внутри, поэтому параллелим безопасно.
  await Promise.all(
    passengerIds.map(async (pid) => {
      await createNotification(
        pid,
        "trip_cancelled",
        "Поездка отменена",
        `Поездка ${trip.fromCity} → ${trip.toCity} отменена администрацией`,
        "/bookings",
      );

      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: trip.id, status: "cancelled" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }),
  );

  logBusinessEvent("trip.cancelled", {
    tripId: trip.id,
    cancelledBy: "admin",
    driverId: trip.driverId,
    passengersAffected: passengerIds.length,
  });

  return c.json(serializeAdminTrip(trip));
});

/**
 * Смена статуса брони администратором (pending/confirmed/declined/cancelled).
 * Тело валидируется контрактом.
 *
 * Учёт мест — как в водительской смене статуса (bookings/index.ts):
 * активная бронь (pending/confirmed) удерживает место. Переход
 * active → неактивный освобождает место, обратный переход — повторно
 * удерживает (с проверкой доступности и занятости места).
 *
 * Реактивация (неактивная → активная) дополнительно требует ЖИВУЮ поездку:
 * status=active и отправление в будущем. Иначе админ мог бы «оживить»
 * бронь на отменённой/завершённой/уехавшей поездке — seatsAvailable
 * уехал бы в минус, а бронь получила бы невозможный статус.
 */
adminRouter.patch("/bookings/:id/status", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const body = await getSanitizedBody(c);
  const parseResult = adminBookingStatusBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid payload" },
      400,
    );
  }

  const newStatus = parseResult.data.status;

  try {
    const result = await db.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: { trip: true },
        });
        if (!booking) {
          return { kind: "not_found" } as const;
        }

        const oldStatus = booking.status;
        const { trip } = booking;

        // Неактивная бронь снова становится активной — сначала проверяем,
        // что поездка вообще допускает активные брони (жизненный цикл).
        if (
          !isActiveBookingStatus(oldStatus) &&
          isActiveBookingStatus(newStatus)
        ) {
          if (trip.status !== "active") {
            return {
              kind: "conflict",
              code: ERROR_CODES.TRIP_NOT_ACTIVE,
              message: "Trip is not active",
            } as const;
          }
          if (trip.departureAt <= new Date()) {
            return {
              kind: "conflict",
              code: ERROR_CODES.CONFLICT,
              message: "Trip has already departed",
            } as const;
          }
        }

        // Активная бронь становится неактивной — освобождаем место
        // (не выше seatsTotal: защита от рассинхрона счётчика).
        if (
          isActiveBookingStatus(oldStatus) &&
          !isActiveBookingStatus(newStatus)
        ) {
          await tx.trip.update({
            where: { id: trip.id },
            data: {
              seatsAvailable: Math.min(
                trip.seatsAvailable + 1,
                trip.seatsTotal,
              ),
            },
          });
        }

        // Неактивная бронь снова становится активной — повторно удерживаем место.
        if (
          !isActiveBookingStatus(oldStatus) &&
          isActiveBookingStatus(newStatus)
        ) {
          if (trip.seatsAvailable <= 0) {
            return {
              kind: "conflict",
              code: ERROR_CODES.CONFLICT,
              message: "Not enough available seats",
            } as const;
          }

          const seatConflict = await tx.booking.findFirst({
            where: {
              tripId: trip.id,
              seat: booking.seat,
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              OR: [
                { status: "confirmed" },
                {
                  status: "pending",
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              ],
              id: { not: booking.id },
            },
          });
          if (seatConflict) {
            return {
              kind: "conflict",
              code: ERROR_CODES.SEAT_TAKEN,
              message: "Seat is already reserved",
            } as const;
          }

          await tx.trip.update({
            where: { id: trip.id },
            data: { seatsAvailable: trip.seatsAvailable - 1 },
          });
        }

        const updated = await tx.booking.update({
          where: { id },
          data: { status: newStatus },
          include: { trip: true, passenger: true },
        });

        return { kind: "updated", booking: updated } as const;
      },
      { isolationLevel: "Serializable" },
    );

    if (result.kind === "not_found") {
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Booking not found" },
        404,
      );
    }

    if (result.kind === "conflict") {
      return c.json({ code: result.code, message: result.message }, 409);
    }

    return c.json(serializeAdminBooking(result.booking));
  } catch (error) {
    // Unique-конфликт partial-индексов (active_seat_booking /
    // active_passenger_booking): классифицируем по имени нарушенного
    // индекса из meta driver-адаптера Prisma 7 — как в POST /bookings.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const constraintName = getUniqueConstraintName(error);

      if (constraintName === "active_seat_booking") {
        return c.json(
          { code: ERROR_CODES.SEAT_TAKEN, message: "Seat is already reserved" },
          409,
        );
      }

      if (constraintName === "active_passenger_booking") {
        return c.json(
          {
            code: ERROR_CODES.ALREADY_BOOKED,
            message: "Passenger already has an active booking for this trip",
          },
          409,
        );
      }

      return c.json(
        { code: ERROR_CODES.BOOKING_CONFLICT, message: "Booking conflict" },
        409,
      );
    }

    // Serializable: параллельное изменение брони/поездки — транзакция не
    // смогла подтвердиться. Клиент получает 409 и может повторить запрос.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Booking was just changed, please retry",
        },
        409,
      );
    }

    // Остальные ошибки — в глобальный onError (лог + Sentry + 500).
    throw error;
  }
});

/**
 * Удаление отзыва администратором (hard delete).
 * На Review нет внешних ссылок, поэтому каскад не требуется.
 * После удаления пересчитываем rating и reviewsCount target-пользователя
 * по оставшимся отзывам — та же логика, что при создании отзыва
 * (recomputeUserRating), в одной транзакции с удалением.
 */
adminRouter.delete("/reviews/:id", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const review = await db.review.findUnique({ where: { id } });
  if (!review) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Review not found" },
      404,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.review.delete({ where: { id } });
    await recomputeUserRating(tx, review.targetUserId);
  });

  return c.json({ ok: true, id });
});

/**
 * Одобрение отзыва (pending → published).
 *
 * После публикации отзыв становится публичным и начинает учитываться
 * в рейтинге получателя, поэтому recomputeUserRating вызывается в той
 * же транзакции, что и смена статуса: статус и агрегат меняются атомарно.
 * 404 — отзыв не найден; 409 — статус не pending (повторное одобрение
 * или одобрение отклонённого отзыва запрещено).
 *
 * Конкурентность: переход «забирается» атомарным updateMany с предикатом
 * status=pending ВНУТРИ Serializable-транзакции. Параллельные
 * approve/reject одного отзыва не могут оба пройти проверку: проигравший
 * получит count=0 (или P2034) и ответит 409 — рейтинг получателя не
 * расходится с финальным статусом отзыва.
 */
adminRouter.patch("/reviews/:id/approve", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  let result:
    | { kind: "not_found" }
    | { kind: "not_pending" }
    | {
        kind: "ok";
        review: Prisma.ReviewGetPayload<{
          include: { author: true; targetUser: true };
        }>;
      };

  try {
    result = await db.$transaction(
      async (tx) => {
        // Атомарный claim перехода: обновляются ONLY pending-отзывы.
        // count=0 — отзыв не найден или уже обработан конкурентным запросом.
        const claim = await tx.review.updateMany({
          where: { id, status: "pending" },
          data: { status: "published" },
        });

        if (claim.count === 0) {
          const exists = await tx.review.findUnique({
            where: { id },
            select: { id: true },
          });
          return exists
            ? { kind: "not_pending" as const }
            : { kind: "not_found" as const };
        }

        const approved = await tx.review.findUniqueOrThrow({
          where: { id },
          include: { author: true, targetUser: true },
        });

        // Отзыв теперь учитывается в рейтинге — пересчитываем агрегат
        // получателя по актуальным данным внутри той же транзакции.
        await recomputeUserRating(tx, approved.targetUserId);

        return { kind: "ok" as const, review: approved };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Review was just changed, please retry",
        },
        409,
      );
    }
    throw error;
  }

  if (result.kind === "not_found") {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Review not found" },
      404,
    );
  }
  if (result.kind === "not_pending") {
    return c.json(
      {
        code: ERROR_CODES.CONFLICT,
        message: "Only pending reviews can be approved",
      },
      409,
    );
  }

  const updated = result.review;

  logBusinessEvent("review.approved", {
    reviewId: updated.id,
    targetUserId: updated.targetUserId,
    authorId: updated.authorId,
  });

  // In-app уведомление автору: не критичный тип, подчиняется тумблеру
  // notificationsEnabled (createNotification проверяет его внутри).
  // Глубокая ссылка ведёт в раздел «Мои отзывы» мини-аппа.
  await createNotification(
    updated.authorId,
    "review_approved",
    "Отзыв опубликован",
    "Ваш отзыв опубликован",
    "/profile?panel=reviews",
  );

  return c.json(serializeAdminReview(updated));
});

/**
 * Отклонение отзыва (pending → rejected).
 *
 * Отклонённый отзыв скрыт из публичного списка. recomputeUserRating НЕ
 * вызывается: pending-отзыв в рейтинг никогда не учитывался, поэтому
 * агрегат получателя отклонением не меняется.
 * 404 — отзыв не найден; 409 — статус не pending.
 *
 * Конкурентность: как в approve — атомарный claim через updateMany
 * с предикатом status=pending. Ждущий reject после чужого approve
 * получает 409, а не перезапись published → rejected.
 */
adminRouter.patch("/reviews/:id/reject", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  let result:
    | { kind: "not_found" }
    | { kind: "not_pending" }
    | {
        kind: "ok";
        review: Prisma.ReviewGetPayload<{
          include: { author: true; targetUser: true };
        }>;
      };

  try {
    result = await db.$transaction(
      async (tx) => {
        const claim = await tx.review.updateMany({
          where: { id, status: "pending" },
          data: { status: "rejected" },
        });

        if (claim.count === 0) {
          const exists = await tx.review.findUnique({
            where: { id },
            select: { id: true },
          });
          return exists
            ? { kind: "not_pending" as const }
            : { kind: "not_found" as const };
        }

        const rejected = await tx.review.findUniqueOrThrow({
          where: { id },
          include: { author: true, targetUser: true },
        });

        return { kind: "ok" as const, review: rejected };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Review was just changed, please retry",
        },
        409,
      );
    }
    throw error;
  }

  if (result.kind === "not_found") {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Review not found" },
      404,
    );
  }
  if (result.kind === "not_pending") {
    return c.json(
      {
        code: ERROR_CODES.CONFLICT,
        message: "Only pending reviews can be rejected",
      },
      409,
    );
  }

  const updated = result.review;

  logBusinessEvent("review.rejected", {
    reviewId: updated.id,
    authorId: updated.authorId,
  });

  // In-app уведомление автору: не критичный тип, подчиняется тумблеру
  // notificationsEnabled (createNotification проверяет его внутри).
  await createNotification(
    updated.authorId,
    "review_rejected",
    "Отзыв отклонён",
    "Ваш отзыв не был опубликован",
    "/profile?panel=reviews",
  );

  return c.json(serializeAdminReview(updated));
});

// ─────────────────────────────────────────────────────────────────────────────
// Справочник городов (CRUD). Доступ — adminGuard (см. выше).
//
// Города хранятся в `City` и используются мини-апом через автодополнение
// при создании/редактировании поездки. Старые поездки ссылаются через
// `Trip.fromCityId`/`Trip.toCityId` (nullable, ON DELETE SET NULL), поэтому
// удаление используемого города не ломает историю, но обнуляет FK.
// Чтобы не «осиротевать» молча — запрещаем удаление, если tripsCount > 0,
// и возвращаем 409. Админ сначала должен переименовать/удалить поездки.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/cities?q=&page=&pageSize= — пагинированный список.
 * Поиск case-insensitive по подстроке имени.
 */
adminRouter.get("/cities", adminReadLimiter, async (c) => {
  const parsed = adminCitiesQuerySchema.safeParse(getSanitizedQuery(c));
  if (!parsed.success) {
    return invalidQueryResponse(c);
  }
  const { q, page, pageSize } = parsed.data;

  const where = q
    ? { name: { contains: q, mode: "insensitive" as const } }
    : {};

  const [total, items] = await Promise.all([
    db.city.count({ where }),
    db.city.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return c.json(
    paginatedCitiesResponseSchema.parse({
      items: items.map(serializeAdminCity),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    }),
    200,
  );
});

/**
 * POST /api/v1/admin/cities — создать город.
 * 200 — успех; 400 — невалидное тело / дубликат имени; 409 — гонка
 * (две вкладки админа создали одно и то же имя, уникальный индекс
 * на nameNormalized защищает).
 */
adminRouter.post("/cities", mutationLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parsed = cityNameBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid body" },
      400,
    );
  }

  const { name } = parsed.data;
  const nameNormalized = cityNameNormalized(name);

  try {
    const created = await db.city.create({
      data: { name, nameNormalized },
    });
    logBusinessEvent("city.created", {
      cityId: created.id,
      name: created.name,
    });
    return c.json(serializeAdminCity(created), 201);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Город с таким именем уже существует",
        },
        409,
      );
    }
    throw error;
  }
});

/**
 * PATCH /api/v1/admin/cities/:id — переименовать.
 */
adminRouter.patch("/cities/:id", mutationLimiter, async (c) => {
  const id = c.req.param("id");
  const body = await getSanitizedBody(c);
  const parsed = cityNameBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid body" },
      400,
    );
  }

  const existing = await db.city.findUnique({ where: { id } });
  if (!existing) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "City not found" },
      404,
    );
  }

  const { name } = parsed.data;
  const nameNormalized = cityNameNormalized(name);

  try {
    const updated = await db.city.update({
      where: { id },
      data: { name, nameNormalized },
    });
    logBusinessEvent("city.renamed", {
      cityId: updated.id,
      from: existing.name,
      to: updated.name,
    });
    return c.json(serializeAdminCity(updated), 200);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Город с таким именем уже существует",
        },
        409,
      );
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/admin/cities/:id — удалить.
 * 409, если на этот город ссылается хотя бы одна поездка
 * (`tripsCount > 0` — денормализованный счётчик, обновляется при
 * создании/удалении Trip). Поездки с FK при удалении города получат
 * `fromCityId = null` благодаря `ON DELETE SET NULL`, но мы не даём
 * удалить, чтобы админ явно пересмотрел историю.
 */
adminRouter.delete("/cities/:id", mutationLimiter, async (c) => {
  const id = c.req.param("id");

  const existing = await db.city.findUnique({ where: { id } });
  if (!existing) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "City not found" },
      404,
    );
  }

  if (existing.tripsCount > 0) {
    return c.json(
      {
        code: ERROR_CODES.CONFLICT,
        message: `Невозможно удалить город «${existing.name}»: на него ссылается ${existing.tripsCount} поездок`,
      },
      409,
    );
  }

  await db.city.delete({ where: { id } });
  logBusinessEvent("city.deleted", { cityId: id, name: existing.name });
  return c.json({ ok: true, id });
});

/**
 * POST /api/v1/admin/cities/recompute-trips-count — полный пересчёт
 * City.tripsCount по ground truth (FK + статус): количество НЕ отменённых
 * поездок, ссылающихся на город через fromCityId/toCityId (логика в
 * recomputeCityTripsCount, cities/counters.ts).
 *
 * Чинит дрейф счётчика: ручные правки в консоли, прямое удаление Trip
 * в обход API, сид без синхронизированных счётчиков. Идемпотентен —
 * безопасно вызывать многократно.
 */
adminRouter.post(
  "/cities/recompute-trips-count",
  mutationLimiter,
  async (c) => {
    const { updated } = await db.$transaction((tx) =>
      recomputeCityTripsCount(tx),
    );
    logBusinessEvent("city.trips_count.recomputed", { updated });
    return c.json({ ok: true, updated }, 200);
  },
);
