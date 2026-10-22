import { z } from "zod";
import { REVIEW_STATUSES } from "../schemas/status.const.js";
import {
  reportCategorySchema,
  reportStatusSchema,
  reportTargetTypeSchema,
} from "../schemas/report.schema.js";

/** Hard cap for each "recent activity" array in `AdminUserDetailDto`. */
export const ADMIN_USER_DETAIL_RECENT_MAX = 20;

/**
 * Hard cap for the bookings array in `AdminTripDetailDto`. Higher than the
 * seat count because cancelled/declined history can outnumber live seats.
 */
export const ADMIN_TRIP_DETAIL_BOOKINGS_MAX = 100;

// ─── Auth ───────────────────────────────────────────────────────────────────
/**
 * Ответ успешного логина админ-панели. Сам JWT передаётся только в httpOnly
 * cookie; expiresAt (epoch ms) — для отображения в UI.
 */
export const adminLoginResponseSchema = z
  .object({
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

/**
 * Состояние сессии админ-панели. Endpoint всегда отвечает 200:
 * фронт не может прочитать httpOnly cookie и опрашивает этот ресурс.
 */
export const adminSessionResponseSchema = z
  .object({
    authenticated: z.boolean(),
    expiresAt: z.number().int().positive().nullable(),
  })
  .strict();

export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;

// ─── Dashboard ──────────────────────────────────────────────────────────────
export const adminDashboardDtoSchema = z
  .object({
    totalUsers: z.number().int().nonnegative(),
    totalTrips: z.number().int().nonnegative(),
    activeTrips: z.number().int().nonnegative(),
    totalBookings: z.number().int().nonnegative(),
    totalReviews: z.number().int().nonnegative(),
    newUsersLast7Days: z.number().int().nonnegative(),
    // Actionable queues: everything that needs an admin decision right now.
    pendingReviews: z.number().int().nonnegative(),
    openReports: z.number().int().nonnegative(),
    unansweredFeedback: z.number().int().nonnegative(),
    telegramPending: z.number().int().nonnegative(),
    telegramFailed: z.number().int().nonnegative(),
  })
  .strict();

export type AdminDashboardDto = z.infer<typeof adminDashboardDtoSchema>;

// ─── Telegram ───────────────────────────────────────────────────────────────
/**
 * Ответ ручного стопа Telegram-доставки (`PATCH /admin/users/:id/telegram-stop`).
 * `cancelledDeliveries` — сколько живых задач outbox переведено в skipped.
 */
export const adminTelegramStopResponseDtoSchema = z
  .object({
    success: z.boolean(),
    hadConsent: z.boolean(),
    cancelledDeliveries: z.number().int().nonnegative(),
  })
  .strict();

export type AdminTelegramStopResponseDto = z.infer<
  typeof adminTelegramStopResponseDtoSchema
>;

/**
 * JSON-снимок Telegram-outbox (`GET /admin/telegram/metrics`). Повторяет
 * `TelegramDeliveryMetrics` из backend/src/services/telegramMetrics.ts:
 * только счётчики, без идентификаторов пользователей и тел сообщений.
 */
export const adminTelegramMetricsDtoSchema = z
  .object({
    channelEnabled: z.boolean(),
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

export type AdminTelegramMetricsDto = z.infer<
  typeof adminTelegramMetricsDtoSchema
>;

// ─── User ───────────────────────────────────────────────────────────────────
export const adminUserDtoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: z.string(),
    rating: z.number(),
    tripsCount: z.number().int().nonnegative(),
    reviewsCount: z.number().int().nonnegative(),
    isVerified: z.boolean(),
    bannedAt: z.string().datetime().nullable(),
    banReason: z.string().nullable(),
    // Telegram-идентификатор (BigInt в БД сериализуется строкой).
    telegramUserId: z.string().nullable(),
    // Производное от tgChatJoinedAt: есть ли у бота согласие на переписку.
    telegramConnected: z.boolean(),
    tgChatJoinedAt: z.string().datetime().nullable(),
    // Момент акцепта правовых документов (доказательство согласия по 152-ФЗ).
    consentAcceptedAt: z.string().datetime().nullable(),
    // Телефон для связи; PII — отдаётся только за adminGuard.
    phone: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AdminUserDto = z.infer<typeof adminUserDtoSchema>;

// ─── Trip ───────────────────────────────────────────────────────────────────
export const adminTripDtoSchema = z
  .object({
    id: z.string(),
    fromCity: z.string(),
    toCity: z.string(),
    fromAddress: z.string(),
    toAddress: z.string(),
    price: z.number().int(),
    seatsTotal: z.number().int(),
    seatsAvailable: z.number().int(),
    status: z.string(),
    departureAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    driverName: z.string(),
    driverId: z.string(),
  })
  .strict();

export type AdminTripDto = z.infer<typeof adminTripDtoSchema>;

/**
 * Компактная бронь в карточке поездки: только идентификаторы и данные,
 * нужные для навигации к полной брони. Полная форма — `AdminBookingDetailDto`.
 */
export const adminTripBookingSummaryDtoSchema = z
  .object({
    id: z.string(),
    seat: z.number().int().positive(),
    status: z.string(),
    passengerId: z.string(),
    passengerName: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AdminTripBookingSummaryDto = z.infer<
  typeof adminTripBookingSummaryDtoSchema
>;

/**
 * Детальная карточка поездки: базовый DTO плюс ограниченный список броней
 * с пассажирами. Массив ограничен на уровне контракта, чтобы ответ не рос
 * бесконечно.
 */
export const adminTripDetailDtoSchema = adminTripDtoSchema
  .extend({
    bookings: z
      .array(adminTripBookingSummaryDtoSchema)
      .max(ADMIN_TRIP_DETAIL_BOOKINGS_MAX),
  })
  .strict();

export type AdminTripDetailDto = z.infer<typeof adminTripDetailDtoSchema>;

// ─── Booking ────────────────────────────────────────────────────────────────
export const adminBookingDtoSchema = z
  .object({
    id: z.string(),
    seat: z.number().int(),
    status: z.string(),
    createdAt: z.string().datetime(),
    tripId: z.string(),
    tripRoute: z.string(),
    passengerId: z.string(),
    passengerName: z.string(),
  })
  .strict();

export type AdminBookingDto = z.infer<typeof adminBookingDtoSchema>;

/**
 * Детальная карточка брони: базовый DTO плюс контекст поездки и пассажира.
 * `tripStatus` отделён от `status` (статус самой брони) — иначе поля
 * столкнулись бы в одной плоской форме. Телефон пассажира — PII, отдаётся
 * только за `adminGuard`.
 */
export const adminBookingDetailDtoSchema = adminBookingDtoSchema
  .extend({
    fromCity: z.string(),
    toCity: z.string(),
    departureAt: z.string().datetime(),
    tripStatus: z.string(),
    driverId: z.string(),
    driverName: z.string(),
    passengerAvatar: z.string(),
    passengerRating: z.number(),
    passengerPhone: z.string().nullable(),
  })
  .strict();

export type AdminBookingDetailDto = z.infer<
  typeof adminBookingDetailDtoSchema
>;

// ─── Review ─────────────────────────────────────────────────────────────────
export const adminReviewDtoSchema = z
  .object({
    id: z.string(),
    rating: z.number().int(),
    text: z.string(),
    targetRole: z.string(),
    status: z.enum(REVIEW_STATUSES),
    tripRoute: z.string(),
    createdAt: z.string().datetime(),
    authorId: z.string(),
    authorName: z.string(),
    targetUserId: z.string(),
    targetUserName: z.string(),
  })
  .strict();

export type AdminReviewDto = z.infer<typeof adminReviewDtoSchema>;

/**
 * Компактная карточка участника отзыва (автор или получатель). Нужна для
 * перехода в карточку пользователя и оценки контекста модерации.
 */
export const adminReviewPartySummaryDtoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: z.string(),
    rating: z.number(),
    bannedAt: z.string().datetime().nullable(),
  })
  .strict();

export type AdminReviewPartySummaryDto = z.infer<
  typeof adminReviewPartySummaryDtoSchema
>;

/**
 * Детальная карточка отзыва: полный текст уже есть в базовом DTO, здесь
 * добавлены сводки автора и получателя. `authorId`/`authorName` и
 * `targetUserId`/`targetUserName` остаются для обратной совместимости.
 */
export const adminReviewDetailDtoSchema = adminReviewDtoSchema
  .extend({
    author: adminReviewPartySummaryDtoSchema,
    target: adminReviewPartySummaryDtoSchema,
  })
  .strict();

export type AdminReviewDetailDto = z.infer<typeof adminReviewDetailDtoSchema>;

// ─── Feedback ───────────────────────────────────────────────────────────────
export const adminFeedbackDtoSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    text: z.string(),
    // Ответ админа (null = ещё не отвечено).
    reply: z.string().nullable(),
    repliedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    userId: z.string(),
    userName: z.string(),
  })
  .strict();

export type AdminFeedbackDto = z.infer<typeof adminFeedbackDtoSchema>;

// ─── User detail ────────────────────────────────────────────────────────────
/**
 * Компактная жалоба в карточке пользователя: только поля, нужные для
 * навигации к полной карточке жалобы. Полная форма — в admin report DTO.
 */
export const adminUserReportSummaryDtoSchema = z
  .object({
    id: z.string(),
    targetType: reportTargetTypeSchema,
    targetId: z.string(),
    category: reportCategorySchema,
    status: reportStatusSchema,
    description: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AdminUserReportSummaryDto = z.infer<
  typeof adminUserReportSummaryDtoSchema
>;

/** Bounded list helper: recent activity must never return an unbounded page. */
const recentItemsSchema = <T extends z.ZodType>(item: T) =>
  z.array(item).max(ADMIN_USER_DETAIL_RECENT_MAX);

/**
 * Детальная карточка пользователя для админки: базовый DTO плюс последние
 * связанные сущности. Массивы ограничены `ADMIN_USER_DETAIL_RECENT_MAX`
 * на уровне контракта, чтобы ответ не разрастался.
 */
export const adminUserDetailDtoSchema = adminUserDtoSchema
  .extend({
    recentTrips: recentItemsSchema(adminTripDtoSchema),
    recentBookings: recentItemsSchema(adminBookingDtoSchema),
    recentReports: recentItemsSchema(adminUserReportSummaryDtoSchema),
    recentFeedback: recentItemsSchema(adminFeedbackDtoSchema),
  })
  .strict();

export type AdminUserDetailDto = z.infer<typeof adminUserDetailDtoSchema>;

// ─── Settings ───────────────────────────────────────────────────────────────
/**
 * Read-only snapshot of the current env-driven rate limits and feature flags.
 * The admin panel displays these; there is no backing DB table for MVP.
 */
export const adminSettingsDtoSchema = z
  .object({
    createTripRateMax: z.number().int(),
    cancelTripRateMax: z.number().int(),
    createBookingRateMax: z.number().int(),
    cancelBookingRateMax: z.number().int(),
    publicReadRateMax: z.number().int(),
    mutationRateMax: z.number().int(),
    allowDevAuth: z.boolean(),
    isProduction: z.boolean(),
    trustProxy: z.boolean(),
  })
  .strict();

export type AdminSettingsDto = z.infer<typeof adminSettingsDtoSchema>;

// ─── Paginated Wrapper ──────────────────────────────────────────────────────
/**
 * Wraps a list of items with offset-pagination metadata. Generic over the item
 * schema so each admin list endpoint gets a concrete, fully-typed page DTO.
 */
export const adminPaginatedSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
    })
    .strict();

export const adminPaginatedUsersSchema = adminPaginatedSchema(adminUserDtoSchema);
export type AdminPaginatedUsers = z.infer<typeof adminPaginatedUsersSchema>;

export const adminPaginatedTripsSchema = adminPaginatedSchema(adminTripDtoSchema);
export type AdminPaginatedTrips = z.infer<typeof adminPaginatedTripsSchema>;

export const adminPaginatedBookingsSchema = adminPaginatedSchema(adminBookingDtoSchema);
export type AdminPaginatedBookings = z.infer<typeof adminPaginatedBookingsSchema>;

export const adminPaginatedReviewsSchema = adminPaginatedSchema(adminReviewDtoSchema);
export type AdminPaginatedReviews = z.infer<typeof adminPaginatedReviewsSchema>;

export const adminPaginatedFeedbackSchema = adminPaginatedSchema(adminFeedbackDtoSchema);
export type AdminPaginatedFeedback = z.infer<typeof adminPaginatedFeedbackSchema>;
