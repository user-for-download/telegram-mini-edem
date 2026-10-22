// backend/src/admin/serializers.ts
// Админ-DTO: плоские формы с ISO-датами, именами связанных сущностей
// и админ-полями (bannedAt), которых нет в публичных сериализаторах.
import type { Prisma, Report, User } from "../generated/prisma/client.js";
import type {
  AdminBookingDetailDto,
  AdminBookingDto,
  AdminFeedbackDto,
  AdminReviewDetailDto,
  AdminReviewDto,
  AdminReviewPartySummaryDto,
  AdminTripBookingSummaryDto,
  AdminTripDetailDto,
  AdminTripDto,
  AdminUserDetailDto,
  AdminUserDto,
  AdminUserReportSummaryDto,
  ReviewStatusValue,
} from "@edem/contracts";
import { DEFAULT_AVATAR_URL } from "../constants.js";
import {
  ADMIN_TRIP_DETAIL_BOOKINGS_MAX,
  ADMIN_USER_DETAIL_RECENT_MAX,
} from "@edem/contracts";

export type TripWithDriver = Prisma.TripGetPayload<{
  include: {
    driver: boolean;
  };
}>;

/**
 * Поездка с водителем и ограниченным списком броней (каждая — с пассажиром)
 * для детальной карточки. `take` ограничивает выборку на уровне запроса,
 * поэтому N+1 не возникает: Prisma делает один include-запрос на bookings.
 */
export type TripWithDriverAndBookings = Prisma.TripGetPayload<{
  include: {
    driver: boolean;
    bookings: {
      include: {
        passenger: boolean;
      };
    };
  };
}>;

export type BookingWithTripAndPassenger = Prisma.BookingGetPayload<{
  include: {
    trip: boolean;
    passenger: boolean;
  };
}>;

/**
 * Бронь с полным контекстом поездки (включая водителя) и пассажиром —
 * для детальной карточки. Отдельный тип нужен, чтобы сериализатор мог
 * отдать driverName, не расширяя тип списка.
 */
export type BookingWithTripDriverAndPassenger = Prisma.BookingGetPayload<{
  include: {
    trip: {
      include: {
        driver: boolean;
      };
    };
    passenger: boolean;
  };
}>;

export type ReviewWithAuthorAndTarget = Prisma.ReviewGetPayload<{
  include: {
    author: boolean;
    targetUser: boolean;
  };
}>;

export type FeedbackWithUser = Prisma.FeedbackGetPayload<{
  include: {
    user: boolean;
  };
}>;

/**
 * Пользователь для админ-панели: без машины, но с bannedAt/banReason,
 * Telegram-состоянием, согласием на обработку ПДн и телефоном.
 * banReason может быть null для старых банов, проставленных до миграции
 * `add_user_ban_reason`. PII (телефон, telegram id) отдаётся только за
 * adminGuard и никогда не логируется.
 */
export function serializeAdminUser(user: User): AdminUserDto {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar || DEFAULT_AVATAR_URL,
    rating: user.rating,
    tripsCount: user.tripsCount,
    reviewsCount: user.reviewsCount,
    isVerified: user.isVerified,
    bannedAt: user.bannedAt?.toISOString() ?? null,
    banReason: user.banReason ?? null,
    // BigInt в JSON напрямую не сериализуется — приводим к строке.
    telegramUserId: user.telegramUserId?.toString() ?? null,
    // Единственный источник истины: consent = есть метка вступления в чат.
    telegramConnected: user.tgChatJoinedAt != null,
    tgChatJoinedAt: user.tgChatJoinedAt?.toISOString() ?? null,
    consentAcceptedAt: user.consentAcceptedAt?.toISOString() ?? null,
    phone: user.phone ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Компактная жалоба в карточке пользователя. В БД targetType/category/status
 * хранятся строками (см. schema.prisma), контракт ждёт enum-значения.
 */
export function serializeAdminUserReportSummary(
  report: Report
): AdminUserReportSummaryDto {
  return {
    id: report.id,
    targetType: report.targetType as AdminUserReportSummaryDto["targetType"],
    targetId: report.targetId,
    category: report.category as AdminUserReportSummaryDto["category"],
    status: report.status as AdminUserReportSummaryDto["status"],
    description: report.description,
    createdAt: report.createdAt.toISOString(),
  };
}

/**
 * Поездка для админ-панели: маршрут, места, цена, статус, имя водителя.
 */
export function serializeAdminTrip(trip: TripWithDriver): AdminTripDto {
  return {
    id: trip.id,
    fromCity: trip.fromCity,
    toCity: trip.toCity,
    fromAddress: trip.fromAddress,
    toAddress: trip.toAddress,
    price: trip.price,
    seatsTotal: trip.seatsTotal,
    seatsAvailable: trip.seatsAvailable,
    status: trip.status,
    departureAt: trip.departureAt.toISOString(),
    createdAt: trip.createdAt.toISOString(),
    driverId: trip.driverId,
    driverName: trip.driver.name,
  };
}

/**
 * Компактная бронь в детальной карточке поездки: данные, нужные для
 * перехода к полной брони, без PII пассажира сверх имени.
 */
export function serializeAdminTripBookingSummary(
  booking: TripWithDriverAndBookings["bookings"][number]
): AdminTripBookingSummaryDto {
  return {
    id: booking.id,
    seat: booking.seat,
    status: booking.status,
    passengerId: booking.passengerId,
    passengerName: booking.passenger.name,
    createdAt: booking.createdAt.toISOString(),
  };
}

/**
 * Детальная карточка поездки: базовый DTO плюс брони с пассажирами.
 * Массив дополнительно ограничен на уровне сериализатора — даже если
 * запрос когда-нибудь забудет `take`, контракт не будет нарушен.
 */
export function serializeAdminTripDetail(
  trip: TripWithDriverAndBookings
): AdminTripDetailDto {
  return {
    ...serializeAdminTrip(trip),
    bookings: trip.bookings
      .slice(0, ADMIN_TRIP_DETAIL_BOOKINGS_MAX)
      .map(serializeAdminTripBookingSummary),
  };
}

/**
 * Бронирование для админ-панели: место, статус, маршрут поездки, имя пассажира.
 */
export function serializeAdminBooking(
  booking: BookingWithTripAndPassenger
): AdminBookingDto {
  return {
    id: booking.id,
    seat: booking.seat,
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
    tripId: booking.tripId,
    tripRoute: `${booking.trip.fromCity} → ${booking.trip.toCity}`,
    passengerId: booking.passengerId,
    passengerName: booking.passenger.name,
  };
}

/**
 * Детальная карточка брони: базовый DTO плюс контекст поездки (маршрут,
 * отправление, статус, водитель) и пассажира (аватар, рейтинг, телефон).
 * Телефон — PII, отдаётся только за adminGuard. Массивов здесь нет,
 * поэтому ответ ограничен размерами одного связанного ряда.
 */
export function serializeAdminBookingDetail(
  booking: BookingWithTripDriverAndPassenger
): AdminBookingDetailDto {
  return {
    ...serializeAdminBooking(booking),
    fromCity: booking.trip.fromCity,
    toCity: booking.trip.toCity,
    departureAt: booking.trip.departureAt.toISOString(),
    // Статус поездки отделён от статуса самой брони (поле `status` выше).
    tripStatus: booking.trip.status,
    driverId: booking.trip.driverId,
    driverName: booking.trip.driver.name,
    passengerAvatar: booking.passenger.avatar || DEFAULT_AVATAR_URL,
    passengerRating: booking.passenger.rating,
    passengerPhone: booking.passenger.phone ?? null,
  };
}

/**
 * Компактная сводка участника отзыва (автор/получатель) для детальной
 * карточки: имя, аватар с fallback, рейтинг и метка бана.
 */
function serializeAdminReviewParty(user: User): AdminReviewPartySummaryDto {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar || DEFAULT_AVATAR_URL,
    rating: user.rating,
    bannedAt: user.bannedAt?.toISOString() ?? null,
  };
}

/**
 * Отзыв для админ-панели: автор, получатель, оценка, текст, маршрут.
 */
export function serializeAdminReview(
  review: ReviewWithAuthorAndTarget
): AdminReviewDto {
  return {
    id: review.id,
    rating: review.rating,
    text: review.text,
    targetRole: review.targetRole,
    // Статус модерации (pending/published/rejected) — часть контракта
    // adminReviewDtoSchema; в БД хранится как String.
    status: review.status as ReviewStatusValue,
    tripRoute: review.tripRoute,
    createdAt: review.createdAt.toISOString(),
    authorId: review.authorId,
    authorName: review.author.name,
    targetUserId: review.targetUserId,
    targetUserName: review.targetUser.name,
  };
}

/**
 * Детальная карточка отзыва: базовый DTO плюс сводки автора и получателя
 * (id, имя, аватар, рейтинг, ban). Полный текст уже есть в базовом DTO;
 * списков нет, поэтому ответ ограничен размерами двух связанных рядов User.
 */
export function serializeAdminReviewDetail(
  review: ReviewWithAuthorAndTarget
): AdminReviewDetailDto {
  return {
    ...serializeAdminReview(review),
    author: serializeAdminReviewParty(review.author),
    target: serializeAdminReviewParty(review.targetUser),
  };
}

/**
 * Обращение пользователя в поддержку для админ-панели.
 * `reply` и `repliedAt` — null, пока админ не ответил.
 */
export function serializeAdminFeedback(
  feedback: FeedbackWithUser
): AdminFeedbackDto {
  return {
    id: feedback.id,
    subject: feedback.subject,
    text: feedback.text,
    reply: feedback.reply,
    repliedAt: feedback.repliedAt?.toISOString() ?? null,
    createdAt: feedback.createdAt.toISOString(),
    userId: feedback.userId,
    userName: feedback.user.name,
  };
}

/**
 * Детальная карточка пользователя: базовый DTO плюс последние связанные
 * сущности. Списки ограничены ADMIN_USER_DETAIL_RECENT_MAX и на уровне
 * запроса, и здесь — ответ не должен разрастаться.
 */
export function serializeAdminUserDetail(input: {
  user: User;
  recentTrips: TripWithDriver[];
  recentBookings: BookingWithTripAndPassenger[];
  recentReports: Report[];
  recentFeedback: FeedbackWithUser[];
}): AdminUserDetailDto {
  return {
    ...serializeAdminUser(input.user),
    recentTrips: input.recentTrips
      .slice(0, ADMIN_USER_DETAIL_RECENT_MAX)
      .map(serializeAdminTrip),
    recentBookings: input.recentBookings
      .slice(0, ADMIN_USER_DETAIL_RECENT_MAX)
      .map(serializeAdminBooking),
    recentReports: input.recentReports
      .slice(0, ADMIN_USER_DETAIL_RECENT_MAX)
      .map(serializeAdminUserReportSummary),
    recentFeedback: input.recentFeedback
      .slice(0, ADMIN_USER_DETAIL_RECENT_MAX)
      .map(serializeAdminFeedback),
  };
}
