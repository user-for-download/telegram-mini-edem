// backend/src/serializers/index.ts
import type { Prisma } from "../generated/prisma/client.js";
import type {
  BookingStatus,
  ReviewStatusValue,
  TripStatus,
} from "@edem/contracts";
import { DEFAULT_AVATAR_URL } from "../constants.js";

/**
 * Единый часовой пояс для отображения дат и времени.
 * Без явного timeZone Intl.DateTimeFormat использует TZ контейнера
 * (в проде обычно UTC), что сдвигает время на экране пользователя.
 */
const DISPLAY_TIMEZONE = "Europe/Moscow";

export type UserWithCar = Prisma.UserGetPayload<{
  include: {
    car: boolean;
  };
}>;

export type TripWithDriver = Prisma.TripGetPayload<{
  include: {
    driver: {
      include: {
        car: boolean;
      };
    };
  };
}>;

export type BookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    trip: {
      include: {
        driver: {
          include: {
            car: boolean;
          };
        };
      };
    };
    passenger: {
      include: {
        car: boolean;
      };
    };
  };
}>;

export type ReviewWithAuthor = Prisma.ReviewGetPayload<{
  include: {
    author: boolean;
  };
}>;

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  weekday: "short",
  timeZone: DISPLAY_TIMEZONE,
});

const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: DISPLAY_TIMEZONE,
});

export function formatDateRu(date: Date): string {
  return dateFmt.format(date);
}

export function formatTimeRu(date: Date): string {
  return timeFmt.format(date);
}

export function serializeUser(
  user: UserWithCar,
  options?: { includePlate?: boolean; includePhone?: boolean },
) {
  const isDeleted = Boolean(user.deletedAt);
  return {
    id: user.id,
    name: isDeleted ? "Удалённый пользователь" : user.name,
    avatar: isDeleted ? DEFAULT_AVATAR_URL : user.avatar || DEFAULT_AVATAR_URL,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    tripsCount: user.tripsCount,
    isVerified: user.isVerified,
    notificationsEnabled: user.notificationsEnabled,
    verifiedAt: user.verifiedAt?.toISOString() ?? null,
    // Телефон (F1) — только по явному флагу: own-контексты и детали
    // поездки для подтверждённой стороны. Публично не отдаём никогда.
    ...(options?.includePhone && !isDeleted && user.phone
      ? { phone: user.phone }
      : {}),
    // Версия показанного онбординга (null — ещё не пройден или сброшен админом).
    onboardingVersion: user.onboardingVersion ?? null,
    car: user.car
      ? {
          model: user.car.model,
          color: user.car.color,
          // plate опционален (string | null в БД): null не сериализуем,
          // т.к. контракт carSchema допускает только string | undefined
          // (fail-closed валидация ответов на клиенте).
          ...(options?.includePlate === false || user.car.plate == null
            ? {}
            : { plate: user.car.plate }),
        }
      : undefined,
    about: isDeleted ? undefined : (user.about ?? undefined),
    createdAt: user.createdAt.toISOString(),
  };
}

export function serializePublicUser(user: UserWithCar) {
  return {
    id: user.id,
    name: user.deletedAt ? "Удалённый пользователь" : user.name,
    avatar: user.deletedAt
      ? DEFAULT_AVATAR_URL
      : user.avatar || DEFAULT_AVATAR_URL,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    tripsCount: user.tripsCount,
    isVerified: user.isVerified,
    car:
      user.deletedAt || !user.car
        ? undefined
        : { model: user.car.model, color: user.car.color },
    about: user.deletedAt ? undefined : (user.about ?? undefined),
    createdAt: user.createdAt.toISOString(),
  };
}

export function serializeTrip(
  trip: TripWithDriver,
  options?: {
    bookedSeats?: number[];
    pendingRequestsCount?: number;
    confirmedBookingsCount?: number;
    myBooking?: {
      id: string;
      seat: number;
      status: string;
      createdAt?: Date;
    } | null;
    includePlate?: boolean;
    includePrivateDetails?: boolean;
    // Телефон водителя в деталях поездки (F1): только водителю
    // и подтверждённому пассажиру — решает вызывающий роут.
    includeDriverPhone?: boolean;
  },
) {
  return {
    id: trip.id,
    fromCity: trip.fromCity,
    // В публичном режиме адреса встречи не отдаются: подстановка города
    // в поле адреса создавала дубли «Москва / Москва» на карточках.
    fromAddress:
      options?.includePrivateDetails === false ? undefined : trip.fromAddress,
    fromCityId: trip.fromCityId ?? null,
    toCity: trip.toCity,
    toAddress:
      options?.includePrivateDetails === false ? undefined : trip.toAddress,
    toCityId: trip.toCityId ?? null,
    date: formatDateRu(trip.departureAt),
    time: formatTimeRu(trip.departureAt),
    departureAt: trip.departureAt.toISOString(),
    durationMinutes: trip.durationMinutes,
    distanceKm: trip.distanceKm,
    price: trip.price,
    seatsTotal: trip.seatsTotal,
    seatsAvailable: trip.seatsAvailable,
    driver: serializeUser(trip.driver, {
      includePlate: options?.includePlate,
      includePhone: options?.includeDriverPhone,
    }),
    tags: trip.tags,
    comment: trip.comment ?? undefined,
    status: trip.status as TripStatus,
    bookedSeats: options?.bookedSeats ?? [],
    pendingRequestsCount: options?.pendingRequestsCount,
    confirmedBookingsCount: options?.confirmedBookingsCount,
    myBooking: options?.myBooking
      ? {
          id: options.myBooking.id,
          seat: options.myBooking.seat,
          status: options.myBooking.status as BookingStatus,
          createdAt: options.myBooking.createdAt
            ? options.myBooking.createdAt.toISOString()
            : undefined,
        }
      : null,
  };
}

export function serializeBooking(booking: BookingWithRelations) {
  return {
    id: booking.id,
    seat: booking.seat,
    status: booking.status as BookingStatus,
    expiresAt: booking.expiresAt?.toISOString() ?? null,
    comment: booking.comment ?? undefined,
    passenger: serializeUser(booking.passenger),
    trip: serializeTrip(booking.trip),
  };
}

const reviewDateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIMEZONE,
});

export function serializeReview(review: ReviewWithAuthor) {
  return {
    id: review.id,
    targetRole: review.targetRole as "passenger" | "driver",
    rating: review.rating,
    text: review.text,
    // Статус модерации (pending/published/rejected) — часть контракта
    // reviewSchema; в публичном списке отдаются только published.
    status: review.status as ReviewStatusValue,
    date: reviewDateFmt.format(review.createdAt),
    tripRoute: review.tripRoute,
    author: {
      id: review.author.id,
      name: review.author.name,
      avatar: review.author.avatar || DEFAULT_AVATAR_URL,
      rating: review.author.rating,
      reviewsCount: review.author.reviewsCount,
      tripsCount: review.author.tripsCount,
    },
  };
}
