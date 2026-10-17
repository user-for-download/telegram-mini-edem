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
          // plate — приватное поле машины (fail-closed, opt-in): отдаётся
          // только при явном `includePlate: true` — own-контексты (профиль,
          // «мои брони») и подтверждённая сторона деталей поездки. Дефолт
          // opt-in: чужому номер не уезжает (водителю — номер чужой машины
          // пассажира). null не сериализуем: контракт carSchema допускает
          // только string | undefined.
          ...(options?.includePlate === true && user.car.plate != null
            ? { plate: user.car.plate }
            : {}),
        }
      : undefined,
    about: isDeleted ? undefined : (user.about ?? undefined),
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Краткая карточка пассажира для аватарстака водителя (см. tripSchema
 * `passengers`). Дублирует только id/name/avatar — полный профиль не нужен.
 * Удалённый пользователь подменяется плейсхолдером, как в serializeUser.
 */
export function serializeTripPassenger(user: {
  id: string;
  name: string;
  avatar: string | null;
  deletedAt: Date | null;
}) {
  const isDeleted = Boolean(user.deletedAt);
  return {
    id: user.id,
    name: isDeleted ? "Удалённый пользователь" : user.name,
    avatar: isDeleted ? DEFAULT_AVATAR_URL : user.avatar || DEFAULT_AVATAR_URL,
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

/**
 * ЕДИНОЕ определение «участника поездки» — права на приватные поля
 * (точные адреса встречи и госномер машины).
 *
 * Правило ровно то же, что в GET /trips/:id (trips/index.ts):
 * водитель либо пассажир с НЕИСТЁКШЕЙ активной (pending/confirmed)
 * бронью. Просроченный, но ещё не выметенный воркером pending прав не
 * даёт — иначе адрес висел бы у пассажира до часа после фактического
 * отказа в брони (тот же expiry-aware предикат, что `activeBookingWhere`
 * в bookings/shared.ts, только для ответа, а не для выборки).
 *
 * Держится здесь, рядом с serializeTrip, потому что serializers — граница
 * приватности: правило участника обязано быть одно, а не повторяться по
 * роутам (иначе «прав на адрес» снова разъедутся между /trips/:id и
 * /bookings/history).
 */
export function isTripParticipant(
  booking: {
    trip: { driverId: string };
    status: string;
    expiresAt?: Date | null;
  },
  viewerId: string,
  now: Date = new Date(),
): boolean {
  if (booking.trip.driverId === viewerId) return true;
  if (booking.status === "confirmed") return true;
  return (
    booking.status === "pending" &&
    (booking.expiresAt == null || booking.expiresAt > now)
  );
}

export function serializeTrip(
  trip: TripWithDriver,
  options?: {
    bookedSeats?: number[];
    pendingRequestsCount?: number;
    confirmedBookingsCount?: number;
    // Подтверждённые пассажиры — только для /trips/my (водитель).
    passengers?: ReturnType<typeof serializeTripPassenger>[];
    myBooking?: {
      id: string;
      seat: number;
      status: string;
      createdAt?: Date;
    } | null;
    /**
     * Приватные поля поездки — FAIL-CLOSED: отдаются только при явном
     * `true`. Раньше дефолт был обратным («отдаём, если не сказали
     * false»), и любой новый вызов без опций молча показывал адрес
     * встречи и госномер машины тому, кому их видеть нельзя (F1:
     * отклонённый пассажир в /bookings/history). Правило участника —
     * водитель или неистёкшая активная бронь, см. trips/index.ts.
     */
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
      options?.includePrivateDetails === true ? trip.fromAddress : undefined,
    fromCityId: trip.fromCityId ?? null,
    toCity: trip.toCity,
    toAddress:
      options?.includePrivateDetails === true ? trip.toAddress : undefined,
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
      // Госномер — приватное поле поездки с тем же fail-closed дефолтом,
      // что и адреса: без явного `includePlate: true` его в ответе нет
      // (в /trips/:id его нет даже для участников — см. вызов роута).
      includePlate: options?.includePlate === true,
      includePhone: options?.includeDriverPhone,
    }),
    tags: trip.tags,
    comment: trip.comment ?? undefined,
    status: trip.status as TripStatus,
    // Флаги опций поездки. В ответе они ОБЯЗАТЕЛЬНЫ (tripSchema без
    // дефолта): «неизвестно» ≠ «выключено», иначе клиент на устаревшем
    // ответе решил бы, что подбор пассажиров отключён, и показал бы
    // ложный пин. Значения приходят из БД — NOT NULL с дефолтом в схеме.
    autoComplete: trip.autoComplete,
    matchingEnabled: trip.matchingEnabled,
    bookedSeats: options?.bookedSeats ?? [],
    pendingRequestsCount: options?.pendingRequestsCount,
    confirmedBookingsCount: options?.confirmedBookingsCount,
    passengers: options?.passengers,
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
  // Приватность вложенной поездки ЗАКРЫТА этим сериализатором по построению:
  // ответ сюда уходит либо владельцу брони (create/status — тот, кто её
  // создал, подтвердил или отклонил), либо водителю самой поездки
  // (/bookings/driver, /bookings/trip/:tripId). В обоих случаях зритель —
  // участник, поэтому приватные поля отдаются явно.
  //
  // Важно: «участник» здесь НЕ вычисляется по статусу брони. Ответ
  // bookings/status.ts на ОТКЛОНЕНИЕ заявки приходит водителю его же
  // поездки, и предикат по статусу (`status === declined` → не участник)
  // молча убрал бы из ответа адреса его собственной поездки.
  // Правило «кому видны адреса» живёт в isTripParticipant и применяется
  // там, где зритель может быть посторонним (bookings/queries.ts).
  return {
    id: booking.id,
    seat: booking.seat,
    status: booking.status as BookingStatus,
    expiresAt: booking.expiresAt?.toISOString() ?? null,
    comment: booking.comment ?? undefined,
    passenger: serializeUser(booking.passenger),
    trip: serializeTrip(booking.trip, {
      includePlate: true,
      includePrivateDetails: true,
    }),
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
