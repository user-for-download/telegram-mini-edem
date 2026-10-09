import { Hono } from "hono";
import { z } from "zod";
import {
  bookingSchema,
  paginatedBookingsResponseSchema,
  passengerBookingSchema,
} from "@edem/contracts";
import { db } from "../db.js";
import type { AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import { reportServerError } from "../client-errors/index.js";
import {
  serializeBooking,
  serializeTrip,
  serializeUser,
} from "../serializers/index.js";
import { ERROR_CODES } from "../errors.js";
import {
  DEFAULT_BOOKINGS_LIMIT,
  MAX_BOOKINGS_LIMIT,
  UUID_REGEX,
} from "./shared.js";

export const queriesRouter = new Hono<AuthEnv>();

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
queriesRouter.get("/my", async (c) => {
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

      // Тот же сериализатор, что у /bookings/driver и /bookings/trip/:id:
      // ручная сборка trip-объекта уже один раз разошлась с контрактом
      // (пропали обязательные autoComplete/matchingEnabled), и клиент
      // отбрасывал ответ целиком. Единый источник исключает дрейф.
      trip: serializeTrip(b.trip),
    };
  });

  const validation = z.array(passengerBookingSchema).safeParse(formatted);
  if (!validation.success) {
    logger.error(
      { issues: validation.error.issues },
      "passenger_bookings_response_validation_failed",
    );
    reportServerError(validation.error, c.req.method, c.req.path);
    return c.json({ message: "Internal response validation failed" }, 500);
  }

  return c.json(validation.data);
});

/**
 * История поездок текущего пользователя как пассажира.
 *
 * Возвращает брони, которые уже не являются активными:
 * - поездка прошла по времени;
 * - поездка завершена/отменена;
 * - бронь была отклонена.
 */
queriesRouter.get("/history", async (c) => {
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

      // Единый сериализатор (см. комментарий в /my) — иначе ответ снова
      // разойдётся с tripSchema и клиент отбросит всю историю.
      trip: serializeTrip(b.trip),
    };
  });

  const validation = z.array(passengerBookingSchema).safeParse(formatted);
  if (!validation.success) {
    logger.error(
      { issues: validation.error.issues },
      "passenger_history_response_validation_failed",
    );
    reportServerError(validation.error, c.req.method, c.req.path);
    return c.json({ message: "Internal response validation failed" }, 500);
  }

  return c.json(validation.data);
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
queriesRouter.get("/driver", async (c) => {
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
    reportServerError(validation.error, c.req.method, c.req.path);
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
queriesRouter.get("/trip/:tripId", async (c) => {
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
    reportServerError(validation.error, c.req.method, c.req.path);
    return c.json({ message: "Internal response validation failed" }, 500);
  }

  return c.json(validation.data);
});
