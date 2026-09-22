import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  bookingSchema,
  createBookingDtoSchema,
  updateBookingStatusDtoSchema,
  paginatedBookingsResponseSchema,
  ACTIVE_BOOKING_STATUSES,
  isActiveBookingStatus,
} from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import {
  serializeBooking,
  serializeUser,
  formatDateRu,
  formatTimeRu,
} from "../serializers/index.js";
import {
  mutationLimiter,
  createBookingLimiter,
  cancelBookingLimiter,
  createUserRateLimiter,
} from "../middleware/rateLimit.js";
import { devRateMax } from "../env.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { getTripRange, rangesOverlap } from "../utils/overlap.js";
import { getUniqueConstraintName } from "../utils/prisma-errors.js";

type HttpStatus = 400 | 403 | 404 | 409;

class BookingError extends Error {
  statusCode: HttpStatus;
  code: string;

  constructor(
    message: string,
    statusCode: HttpStatus = 400,
    code: string = ERROR_CODES.VALIDATION_FAILED,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

import { logBusinessEvent } from "../logger/business.js";
import { createNotification } from "../services/notification.service.js";
import { wsManager } from "../ws/manager.js";

type BookingFull = Prisma.BookingGetPayload<{
  include: {
    trip: { include: { driver: { include: { car: true } } } };
    passenger: { include: { car: true } };
  };
}>;

type CreateResult =
  | { kind: "created"; booking: BookingFull }
  | { kind: "idempotent"; booking: BookingFull };

/**
 * Пагинация заявок на поездку (GET /bookings/trip/:tripId).
 * nextCursor — id последней заявки страницы; null означает конец списка.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_BOOKINGS_LIMIT = 50;
const MAX_BOOKINGS_LIMIT = 50;
const PENDING_BOOKING_TTL_MS = 24 * 60 * 60 * 1000;

function activeBookingWhere(now = new Date()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: "confirmed" },
      {
        status: "pending",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ],
  };
}

// Ограниченный in-tx добор просроченных pending при создании брони:
// не держим Serializable-транзакцию дольше необходимого — полный sweep
// просрочек делает воркер tripWorker раз в час (см. expirePendingBookings).
const IN_TX_EXPIRY_SWEEP_LIMIT = 20;

async function releaseExpiredBookings(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  const expired = await tx.booking.findMany({
    where: { status: "pending", expiresAt: { lte: now } },
    select: { id: true, tripId: true },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: IN_TX_EXPIRY_SWEEP_LIMIT,
  });

  for (const booking of expired) {
    const released = await tx.booking.updateMany({
      where: { id: booking.id, status: "pending", expiresAt: { lte: now } },
      data: {
        status: "declined",
        cancelledAt: now,
        cancelledByType: "system",
        cancellationReason: "Booking request expired",
      },
    });
    if (released.count === 1) {
      await tx.trip.updateMany({
        where: { id: booking.tripId, status: "active" },
        data: { seatsAvailable: { increment: 1 } },
      });
    }
  }
}

export const bookingsRouter = new Hono<AuthEnv>();

const bookingDecisionLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: devRateMax(100),
  keyPrefix: "driver-booking-decision",
});

bookingsRouter.use("*", requireUser);

/**
 * Брони текущего пользователя как пассажира.
 *
 * Возвращает не просто брони, а enriched-объекты:
 * - scope: active | history;
 * - canReview: можно ли оставить отзыв;
 * - hasReview: оставлен ли отзыв;
 * - trip.departureAt: ISO-дата для сортировки;
 * - trip.status: статус поездки.
 */
bookingsRouter.get("/my", async (c) => {
  const user = c.get("user");

  const bookings = await db.booking.findMany({
    where: {
      passengerId: user.id,
    },
    include: {
      trip: {
        include: {
          driver: { include: { car: true } },
        },
      },
      passenger: { include: { car: true } },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (bookings.length === 0) {
    return c.json([]);
  }

  const tripIds = bookings.map((booking) => booking.tripId);

  const reviews = await db.review.findMany({
    where: {
      authorId: user.id,
      tripId: {
        in: tripIds,
      },
    },
    select: {
      tripId: true,
    },
  });

  const reviewedTripIds = new Set(
    reviews
      .map((review) => review.tripId)
      .filter((tripId): tripId is string => Boolean(tripId)),
  );

  const now = new Date();

  const formatted = bookings.map((b) => {
    const isTripCompleted =
      b.trip.status === "completed" || b.trip.departureAt <= now;

    const isActive =
      (b.status === "pending" || b.status === "confirmed") &&
      b.trip.status === "active" &&
      !isTripCompleted;

    const hasReview = reviewedTripIds.has(b.tripId);

    const canReview =
      b.status === "confirmed" &&
      b.trip.status !== "cancelled" &&
      isTripCompleted &&
      !hasReview;

    return {
      id: b.id,
      seat: b.seat,
      status: b.status as "pending" | "confirmed" | "declined" | "cancelled",
      comment: b.comment || undefined,

      /**
       * Поля для клиентской логики истории и отзывов.
       */
      scope: isActive ? "active" : "history",
      canReview,
      hasReview,

      passenger: serializeUser(b.passenger),

      trip: {
        id: b.trip.id,
        fromCity: b.trip.fromCity,
        fromAddress: b.trip.fromAddress,
        toCity: b.trip.toCity,
        toAddress: b.trip.toAddress,
        date: formatDateRu(b.trip.departureAt),
        time: formatTimeRu(b.trip.departureAt),
        durationMinutes: b.trip.durationMinutes,
        distanceKm: b.trip.distanceKm,
        price: b.trip.price,
        seatsTotal: b.trip.seatsTotal,
        seatsAvailable: b.trip.seatsAvailable,

        /**
         * Служебные поля для frontend.
         */
        status: b.trip.status as "active" | "cancelled" | "completed",
        departureAt: b.trip.departureAt.toISOString(),

        // Профиль водителя (платформенный ID наружу не отдаётся).
        driver: serializeUser(b.trip.driver),

        tags: b.trip.tags,
        comment: b.trip.comment || undefined,
      },
    };
  });

  return c.json(formatted);
});

/**
 * История поездок текущего пользователя как пассажира.
 *
 * Возвращает брони, которые уже не являются активными:
 * - поездка прошла по времени;
 * - поездка завершена/отменена;
 * - бронь была отклонена.
 */
bookingsRouter.get("/history", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const history = await db.booking.findMany({
    where: {
      passengerId: user.id,
      OR: [
        { trip: { departureAt: { lte: now } } },
        { trip: { status: { in: ["cancelled", "completed"] } } },
        { status: "declined" },
      ],
    },
    include: {
      trip: {
        include: {
          driver: {
            include: {
              car: true,
            },
          },
        },
      },
      passenger: {
        include: {
          car: true,
        },
      },
    },
    orderBy: {
      trip: {
        departureAt: "desc",
      },
    },
  });

  if (history.length === 0) {
    return c.json([]);
  }

  const tripIds = Array.from(new Set(history.map((b) => b.tripId)));

  const reviews = await db.review.findMany({
    where: {
      authorId: user.id,
      tripId: {
        in: tripIds,
      },
    },
    select: {
      tripId: true,
    },
  });

  const reviewedTripIds = new Set(
    reviews
      .map((review) => review.tripId)
      .filter((tripId): tripId is string => Boolean(tripId)),
  );

  const formatted = history.map((b) => {
    const tripIsCompleted =
      b.trip.status === "completed" || b.trip.departureAt <= now;

    const hasReview = reviewedTripIds.has(b.tripId);

    const canReview =
      b.status === "confirmed" &&
      b.trip.status !== "cancelled" &&
      tripIsCompleted &&
      !hasReview;

    let historyCategory: "completed" | "cancelled" | "other" = "other";
    if (b.trip.status === "cancelled" || b.status === "declined") {
      historyCategory = "cancelled";
    } else if (
      b.status === "confirmed" &&
      (b.trip.status === "completed" || tripIsCompleted)
    ) {
      historyCategory = "completed";
    } else if (b.status === "pending" && tripIsCompleted) {
      historyCategory = "cancelled"; // Не состоялась
    }

    return {
      id: b.id,
      seat: b.seat,
      status: b.status as "pending" | "confirmed" | "declined" | "cancelled",
      comment: b.comment || undefined,

      canReview,
      hasReview,
      historyCategory,

      passenger: serializeUser(b.passenger),

      trip: {
        id: b.trip.id,
        fromCity: b.trip.fromCity,
        fromAddress: b.trip.fromAddress,
        toCity: b.trip.toCity,
        toAddress: b.trip.toAddress,

        date: formatDateRu(b.trip.departureAt),
        time: formatTimeRu(b.trip.departureAt),

        durationMinutes: b.trip.durationMinutes,
        distanceKm: b.trip.distanceKm,
        price: b.trip.price,
        seatsTotal: b.trip.seatsTotal,
        seatsAvailable: b.trip.seatsAvailable,

        status: b.trip.status as "active" | "cancelled" | "completed",
        departureAt: b.trip.departureAt.toISOString(),

        driver: serializeUser(b.trip.driver),

        tags: b.trip.tags,
        comment: b.trip.comment || undefined,
      },
    };
  });

  return c.json(formatted);
});

/**
 * Pending-заявки на все активные поездки текущего водителя.
 *
 * Нужен главной странице мини-аппа: водитель видит сводку заявок
 * по всем своим будущим поездкам и открывает досье пассажира в модалке.
 *
 * Условия выборки:
 * - только pending, ещё не истёкшие по TTL (expiresAt);
 * - поездка активна и отправляется в будущем;
 * - сортировка по времени отправления, затем по времени создания.
 */
bookingsRouter.get("/driver", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const bookings = await db.booking.findMany({
    where: {
      status: "pending",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      trip: {
        driverId: user.id,
        status: "active",
        departureAt: { gt: now },
      },
    },
    include: {
      trip: {
        include: {
          driver: { include: { car: true } },
        },
      },
      passenger: { include: { car: true } },
    },
    orderBy: [
      { trip: { departureAt: "asc" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: MAX_BOOKINGS_LIMIT,
  });

  const response = bookings.map((booking) => serializeBooking(booking));

  const validation = z.array(bookingSchema).safeParse(response);
  if (!validation.success) {
    logger.error(
      { issues: validation.error.issues },
      "driver_bookings_response_validation_failed",
    );
    return c.json({ message: "Internal response validation failed" }, 500);
  }

  return c.json(validation.data);
});

/**
 * Заявки на поездку для водителя (cursor-based пагинация).
 * Этот эндпоинт нужен экрану заявок на мою поездку
 * (telegram-app: TripRequestsModal/TripRequestsBody).
 *
 * Параметры:
 * - limit: 1–50 (по умолчанию 50), значения вне диапазона клампаются;
 * - cursor: UUID id последней заявки предыдущей страницы (необязательный).
 */
bookingsRouter.get("/trip/:tripId", async (c) => {
  const user = c.get("user");
  const tripId = c.req.param("tripId");

  const trip = await db.trip.findUnique({
    where: { id: tripId },
  });

  if (!trip) {
    return c.json({ message: "Trip not found" }, 404);
  }

  if (trip.driverId !== user.id) {
    return c.json({ message: "Forbidden" }, 403);
  }

  const rawLimit = Number(c.req.query("limit") ?? DEFAULT_BOOKINGS_LIMIT);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_BOOKINGS_LIMIT)
    : DEFAULT_BOOKINGS_LIMIT;

  const cursor = c.req.query("cursor");
  if (cursor !== undefined && !UUID_REGEX.test(cursor)) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid cursor format" },
      400,
    );
  }

  // take: limit + 1 — лишний элемент определяет hasMore.
  // cursor + skip: 1 пропускает саму запись-курсор; связка orderBy
  // [createdAt desc, id desc] гарантирует стабильный порядок при одинаковых createdAt.
  const bookings = await db.booking.findMany({
    where: { tripId },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      trip: {
        include: {
          driver: { include: { car: true } },
        },
      },
      passenger: { include: { car: true } },
    },
  });

  const hasMore = bookings.length > limit;
  const items = hasMore ? bookings.slice(0, limit) : bookings;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  const response = {
    // Профили пассажиров (платформенные ID наружу не отдаются).
    items: items.map((booking) =>
      serializeBooking(booking),
    ),
    pagination: { nextCursor, hasMore, limit },
  };

  const validation = paginatedBookingsResponseSchema.safeParse(response);
  if (!validation.success) {
    logger.error(
      { issues: validation.error.issues, tripId },
      "bookings_pagination_response_validation_failed",
    );
    return c.json({ message: "Internal response validation failed" }, 500);
  }

  return c.json(validation.data);
});

/**
 * Создание брони пассажиром.
 * Статус всегда pending.
 * Pending сразу удерживает место.
 */
bookingsRouter.post("/", mutationLimiter, createBookingLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = createBookingDtoSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      { message: "Invalid payload", errors: z.formatError(parseResult.error) },
      400,
    );
  }

  const { tripId, seat, comment } = parseResult.data;
  const passenger = c.get("user");

  try {
    const result: CreateResult = await db.$transaction(
      async (tx) => {
        await releaseExpiredBookings(tx, new Date());
        const trip = await tx.trip.findUnique({
          where: { id: tripId },
        });

        if (!trip) {
          throw new BookingError("Trip not found", 404, ERROR_CODES.NOT_FOUND);
        }

        if (trip.status !== "active") {
          throw new BookingError(
            "Trip is not active",
            400,
            ERROR_CODES.TRIP_NOT_ACTIVE,
          );
        }

        // Запрещаем бронировать уже уехавшие поездки.
        // Авто-завершение воркером происходит только через 24 часа — без этой
        // проверки пассажир мог бы забронировать место в уже уехавшей поездке.
        if (trip.departureAt <= new Date()) {
          throw new BookingError(
            "Trip has already departed",
            400,
            ERROR_CODES.TRIP_IN_PAST,
          );
        }

        if (trip.driverId === passenger.id) {
          throw new BookingError(
            "Driver cannot book own trip",
            400,
            ERROR_CODES.FORBIDDEN,
          );
        }

        // Запрещаем бронировать поездку, пересекающуюся по времени с другой
        // активной броней пассажира (pending/confirmed на active-поездку).
        const newRange = getTripRange(trip.departureAt, trip.durationMinutes);

        const passengerActiveBookings = await tx.booking.findMany({
          where: {
            passengerId: passenger.id,
            // Исключаем брони на ЭТУ поездку: они обрабатываются ниже
            // (идемпотентный retry / ALREADY_BOOKED).
            tripId: { not: tripId },
            ...activeBookingWhere(),
            trip: {
              status: "active",
              departureAt: { lt: newRange.end },
            },
          },
          include: {
            trip: { select: { departureAt: true, durationMinutes: true } },
          },
        });

        const hasOverlap = passengerActiveBookings.some((b) =>
          rangesOverlap(
            newRange,
            getTripRange(b.trip.departureAt, b.trip.durationMinutes),
          ),
        );

        if (hasOverlap) {
          throw new BookingError(
            "У вас уже есть бронь на поездку в это время",
            409,
            ERROR_CODES.PASSENGER_BOOKING_OVERLAP,
          );
        }

        if (seat < 1 || seat > trip.seatsTotal) {
          throw new BookingError(
            "Seat is out of range",
            400,
            ERROR_CODES.VALIDATION_FAILED,
          );
        }

        if (trip.seatsAvailable <= 0) {
          throw new BookingError(
            "Not enough available seats",
            409,
            ERROR_CODES.CONFLICT,
          );
        }

        // Слот занят, только если на нём висит активная бронь.
        // declined/cancelled слот освобождают и повторной подаче не мешают —
        // предикат обязан совпадать с partial-индексом active_seat_booking
        // (F15), поэтому используем общий ACTIVE_BOOKING_STATUSES, а не
        // захардкоженные литералы.
        const seatConflict = await tx.booking.findFirst({
          where: {
            tripId,
            seat,
            ...activeBookingWhere(),
          },
          select: { id: true, passengerId: true },
        });

        if (seatConflict) {
          // Псевдо-идемпотентность: конфликт на НАШЕМ же месте — клиент
          // повторил запрос после таймаута, а бронь уже создалась.
          // Возвращаем существующую бронь с 200 вместо 409.
          if (seatConflict.passengerId === passenger.id) {
            const existing = await tx.booking.findUnique({
              where: { id: seatConflict.id },
              include: {
                trip: {
                  include: {
                    driver: {
                      include: {
                        car: true,
                      },
                    },
                  },
                },
                passenger: {
                  include: {
                    car: true,
                  },
                },
              },
            });
            if (existing) {
              return { kind: "idempotent", booking: existing };
            }
          }

          throw new BookingError(
            "Seat is already reserved",
            409,
            ERROR_CODES.SEAT_TAKEN,
          );
        }

        // Одна активная бронь на поездку (F15: declined/cancelled не в счёт —
        // предикат совпадает с partial-индексом active_passenger_booking).
        const passengerConflict = await tx.booking.findFirst({
          where: {
            tripId,
            passengerId: passenger.id,
            ...activeBookingWhere(),
          },
        });

        if (passengerConflict) {
          throw new BookingError(
            "You already have an active booking for this trip",
            409,
            ERROR_CODES.ALREADY_BOOKED,
          );
        }

        await tx.trip.update({
          where: { id: tripId },
          data: {
            seatsAvailable: trip.seatsAvailable - 1,
          },
        });

        const created = await tx.booking.create({
          data: {
            tripId,
            passengerId: passenger.id,
            seat,
            comment,
            status: "pending",
            expiresAt: new Date(Date.now() + PENDING_BOOKING_TTL_MS),
          },
          include: {
            trip: {
              include: {
                driver: {
                  include: {
                    car: true,
                  },
                },
              },
            },
            passenger: {
              include: {
                car: true,
              },
            },
          },
        });

        return { kind: "created", booking: created };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.kind === "idempotent") {
      logger.info(
        {
          bookingId: result.booking.id,
          tripId,
          seat,
          passengerId: passenger.id,
        },
        "booking_idempotent_return",
      );
      return c.json(serializeBooking(result.booking), 200);
    }

    const booking = result.booking;

    logBusinessEvent("booking.created", {
      bookingId: booking.id,
      tripId,
      passengerId: passenger.id,
      seat,
    });

    await createNotification(
      booking.trip.driverId,
      "booking_created",
      "Новая заявка",
      `Получена новая заявка на место ${seat} в поездке ${booking.trip.fromCity} → ${booking.trip.toCity}`,
    );

    // Внешняя доставка водителю — только через утверждённый канал
    // (Bot API заблокирован, см. ADR). In-app запись выше + WS-hint ниже.

    wsManager.sendToUser(booking.trip.driverId, {
      type: "booking:new",
      payload: { bookingId: booking.id, tripId },
    });

    wsManager.sendToUser(booking.trip.driverId, {
      type: "notification:new",
      payload: { id: "refresh" },
    });

    return c.json(serializeBooking(booking), 201);
  } catch (error) {
    // Ловим ошибку уникального индекса (гонка броней на уровне БД).
    // Prisma 7 (pg driver-адаптер) отдаёт имя нарушенного индекса:
    // meta.driverAdapterError.cause.constraint.index — «active_seat_booking»
    // (tripId, seat) или «active_passenger_booking» (tripId, passengerId),
    // см. prisma/migrations/*_booking_unique_indexes. Классификация по имени
    // однозначна.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const constraintName = getUniqueConstraintName(error);

      logger.info(
        { constraintName, tripId, seat, passengerId: passenger.id },
        "booking_p2002_conflict",
      );

      // Случай 1: конфликт на active_seat_booking (tripId, seat).
      // Либо наш retry (гонка двух одинаковых запросов — оба прошли
      // pre-check, один вставил), либо место занял другой пассажир.
      // Предикат — тот же ACTIVE_BOOKING_STATUSES, что в pre-check'ах и
      // partial-индексе (F15): ищем только активную бронь.
      if (constraintName === "active_seat_booking") {
        const existingBooking = await db.booking.findFirst({
          where: {
            tripId,
            seat,
            passengerId: passenger.id,
            status: { in: [...ACTIVE_BOOKING_STATUSES] },
          },
          include: {
            trip: { include: { driver: { include: { car: true } } } },
            passenger: { include: { car: true } },
          },
        });

        if (existingBooking) {
          logger.info(
            { bookingId: existingBooking.id, tripId, seat },
            "booking_idempotent_return",
          );
          return c.json(serializeBooking(existingBooking), 200);
        }

        return c.json(
          { code: ERROR_CODES.SEAT_TAKEN, message: "Seat just taken" },
          409,
        );
      }

      // Случай 2: конфликт на active_passenger_booking (tripId, passengerId) —
      // у пассажира уже есть активная бронь на ДРУГОЕ место этой поездки.
      if (constraintName === "active_passenger_booking") {
        return c.json(
          {
            code: ERROR_CODES.ALREADY_BOOKED,
            message: "You already have an active booking for this trip",
          },
          409,
        );
      }

      // Случай 3: неизвестный индекс — общий конфликт (логируем как ошибку).
      logger.error(
        { constraintName, tripId, seat, passengerId: passenger.id },
        "booking_p2002_unknown_target",
      );
      return c.json(
        { code: ERROR_CODES.BOOKING_CONFLICT, message: "Booking conflict" },
        409,
      );
    }

    // Serializable: гонка двух броней на одно место — транзакция не смогла
    // подтвердиться (write conflict / deadlock). Клиент видит 409 и может
    // повторить бронь — место при этом гарантированно занято одной из сторон.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        { code: ERROR_CODES.SEAT_TAKEN, message: "Место только что заняли" },
        409,
      );
    }

    if (error instanceof BookingError) {
      return c.json(
        { code: error.code, message: error.message },
        error.statusCode as ContentfulStatusCode,
      );
    }

    logger.error(
      {
        err: error,
        endpoint: "POST /api/bookings",
      },
      "booking_create_failed",
    );

    return c.json({ message: "Internal server error" }, 500);
  }
});

/**
 * Смена статуса брони водителем.
 * pending/confirmed считаются активным удержанием места.
 * declined освобождает место.
 */
bookingsRouter.patch("/:id/status", bookingDecisionLimiter, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  // Санитизируем тело ДО Zod-валидации (security-audit §2: все мутации
  // через getSanitizedBody, без прямых c.req.json()): XSS-строки в status
  // обезвреживаются, неизвестный статус отклоняется схемой с 400 —
  // состояние брони при этом не меняется (транзакция ниже не стартует).
  const body = await getSanitizedBody(c);
  const parseResult = updateBookingStatusDtoSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ message: "Invalid payload" }, 400);
  }

  const newStatus = parseResult.data.status;

  // Водитель может только подтвердить или отклонить.
  // «cancelled» устанавливается пассажиром или при отмене поездки.
  if (newStatus !== "confirmed" && newStatus !== "declined") {
    return c.json(
      { message: "Driver can only confirm or decline bookings" },
      400,
    );
  }

  let oldStatus = "";
  let passengerId = "";

  try {
    const updated = await db.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            trip: {
              include: {
                driver: {
                  include: {
                    car: true,
                  },
                },
              },
            },
            passenger: {
              include: {
                car: true,
              },
            },
          },
        });

        if (!booking) {
          throw new BookingError(
            "Booking not found",
            404,
            ERROR_CODES.NOT_FOUND,
          );
        }

        if (booking.trip.driverId !== user.id) {
          throw new BookingError("Forbidden", 403, ERROR_CODES.FORBIDDEN);
        }

        oldStatus = booking.status;
        passengerId = booking.passengerId;

        if (booking.status === newStatus) {
          return { booking, changed: false };
        }

        if (booking.status !== "pending") {
          throw new BookingError(
            "Only pending bookings can be confirmed or declined",
            409,
            ERROR_CODES.CONFLICT,
          );
        }

        if (booking.expiresAt && booking.expiresAt <= new Date()) {
          throw new BookingError(
            "Booking request has expired",
            409,
            ERROR_CODES.CONFLICT,
          );
        }

        const trip = await tx.trip.findUnique({
          where: { id: booking.tripId },
        });

        if (!trip) {
          throw new BookingError("Trip not found", 404, ERROR_CODES.NOT_FOUND);
        }

        if (trip.status !== "active" || trip.departureAt <= new Date()) {
          throw new BookingError(
            "Trip can no longer be changed",
            409,
            ERROR_CODES.TRIP_NOT_ACTIVE,
          );
        }

        /**
         * Если бронь становится confirmed, проверяем,
         * что на этом месте нет другого подтверждённого пассажира.
         */
        if (newStatus === "confirmed") {
          const confirmedConflict = await tx.booking.findFirst({
            where: {
              tripId: booking.tripId,
              seat: booking.seat,
              status: "confirmed",
              id: {
                not: booking.id,
              },
            },
          });

          if (confirmedConflict) {
            throw new BookingError(
              "Another passenger is already confirmed for this seat",
              409,
              ERROR_CODES.SEAT_TAKEN,
            );
          }
        }

        /**
         * Если бронь переходит из неактивного состояния в активное,
         * нужно снова удержать место.
         */
        if (
          isActiveBookingStatus(newStatus) &&
          !isActiveBookingStatus(oldStatus)
        ) {
          if (trip.status !== "active") {
            throw new BookingError(
              "Trip is not active",
              400,
              ERROR_CODES.TRIP_NOT_ACTIVE,
            );
          }

          if (trip.seatsAvailable <= 0) {
            throw new BookingError(
              "Not enough available seats",
              409,
              ERROR_CODES.CONFLICT,
            );
          }

          const activeConflict = await tx.booking.findFirst({
            where: {
              tripId: booking.tripId,
              seat: booking.seat,
              ...activeBookingWhere(),
              id: {
                not: booking.id,
              },
            },
          });

          if (activeConflict) {
            throw new BookingError(
              "Seat is already reserved",
              409,
              ERROR_CODES.SEAT_TAKEN,
            );
          }

          await tx.trip.update({
            where: { id: booking.tripId },
            data: {
              seatsAvailable: { decrement: 1 },
            },
          });
        }

        /**
         * Если активная бронь становится неактивной,
         * освобождаем место.
         */
        if (
          !isActiveBookingStatus(newStatus) &&
          isActiveBookingStatus(oldStatus)
        ) {
          await tx.trip.update({
            where: { id: booking.tripId },
            data: {
              seatsAvailable: Math.min(
                trip.seatsAvailable + 1,
                trip.seatsTotal,
              ),
            },
          });
        }

        const updatedBooking = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: newStatus,
          },
          include: {
            trip: {
              include: {
                driver: {
                  include: {
                    car: true,
                  },
                },
              },
            },
            passenger: {
              include: {
                car: true,
              },
            },
          },
        });

        return { booking: updatedBooking, changed: true };
      },
      { isolationLevel: "Serializable" },
    );

    if (!updated.changed) {
      return c.json(serializeBooking(updated.booking));
    }

    logBusinessEvent("booking.status_changed", {
      bookingId: id,
      tripId: updated.booking.tripId,
      oldStatus,
      newStatus,
      driverId: user.id,
    });

    await createNotification(
      passengerId,
      "booking_status_changed",
      newStatus === "confirmed" ? "Заявка подтверждена" : "Заявка отклонена",
      `Водитель ${newStatus === "confirmed" ? "подтвердил" : "отклонил"} вашу заявку в поездке ${updated.booking.trip.fromCity} → ${updated.booking.trip.toCity}`,
      // Deep-link: тап по push открывает «Мои брони».
      "/bookings",
    );

    wsManager.sendToUser(passengerId, {
      type: "booking:status_changed",
      payload: {
        bookingId: id,
        tripId: updated.booking.tripId,
        status: newStatus,
      },
    });

    wsManager.sendToUser(passengerId, {
      type: "notification:new",
      payload: { id: "refresh" },
    });

    return c.json(serializeBooking(updated.booking));
  } catch (error) {
    if (error instanceof BookingError) {
      return c.json(
        { code: error.code, message: error.message },
        error.statusCode as ContentfulStatusCode,
      );
    }

    // Unique-конфликт partial-индексов (active_seat_booking /
    // active_passenger_booking) — 409, как и в POST /bookings.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return c.json(
        { code: ERROR_CODES.BOOKING_CONFLICT, message: "Booking conflict" },
        409,
      );
    }

    // Serializable: параллельное изменение брони/поездки — клиент
    // получает 409 и может повторить запрос с актуальными данными.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Бронь только что изменилась, попробуйте ещё раз",
        },
        409,
      );
    }

    logger.error(
      {
        err: error,
        endpoint: "PATCH /api/bookings/:id/status",
      },
      "booking_status_update_failed",
    );

    return c.json({ message: "Internal server error" }, 500);
  }
});

/**
 * Отмена брони пассажиром.
 *
 * Правила:
 * - отменять может только пассажир, который создал бронь;
 * - отменять можно только pending/confirmed;
 * - поездка должна быть active;
 * - активная бронь освобождает место.
 */
bookingsRouter.patch("/:id/cancel", cancelBookingLimiter, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  try {
    const txResult = await db.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            trip: true,
          },
        });

        if (!booking) {
          throw new BookingError(
            "Booking not found",
            404,
            ERROR_CODES.NOT_FOUND,
          );
        }

        if (booking.passengerId !== user.id) {
          throw new BookingError("Forbidden", 403, ERROR_CODES.FORBIDDEN);
        }

        if (booking.status !== "pending" && booking.status !== "confirmed") {
          throw new BookingError(
            "Booking is already cancelled",
            400,
            ERROR_CODES.CONFLICT,
          );
        }

        if (booking.trip.status !== "active") {
          throw new BookingError(
            "Trip is not active",
            400,
            ERROR_CODES.TRIP_NOT_ACTIVE,
          );
        }

        if (booking.trip.departureAt <= new Date()) {
          throw new BookingError(
            "Cannot cancel booking after trip departure",
            400,
            ERROR_CODES.TRIP_IN_PAST,
          );
        }

        await tx.trip.update({
          where: { id: booking.tripId },
          data: {
            seatsAvailable: Math.min(
              booking.trip.seatsAvailable + 1,
              booking.trip.seatsTotal,
            ),
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledByType: "user",
            cancelledByUserId: user.id,
          },
        });

        return { tripId: booking.tripId, driverId: booking.trip.driverId };
      },
      { isolationLevel: "Serializable" },
    );

    logBusinessEvent("booking.cancelled", {
      bookingId: id,
      passengerId: user.id,
    });

    wsManager.sendToUser(txResult.driverId, {
      type: "booking:status_changed",
      payload: { bookingId: id, tripId: txResult.tripId, status: "cancelled" },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof BookingError) {
      return c.json(
        { code: error.code, message: error.message },
        error.statusCode as ContentfulStatusCode,
      );
    }

    // Serializable: параллельная отмена той же брони — одна из транзакций
    // не сможет подтвердиться (write conflict). Возвращаем 409 вместо 500:
    // место при этом гарантированно освобождено ровно один раз.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Бронь только что изменилась, попробуйте ещё раз",
        },
        409,
      );
    }

    logger.error(
      {
        err: error,
        endpoint: "PATCH /api/bookings/:id/cancel",
      },
      "booking_cancel_failed",
    );

    return c.json({ message: "Internal server error" }, 500);
  }
});
