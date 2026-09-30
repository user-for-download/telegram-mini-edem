// backend/src/reviews/index.ts
import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createReviewDtoSchema, paginatedReviewsResponseSchema } from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import { reportServerError } from "../client-errors/index.js";
import { serializeTrip, serializeReview, type TripWithDriver } from "../serializers/index.js";
import {
  publicReadLimiter,
  mutationLimiter,
  reviewsReadLimiter,
} from "../middleware/rateLimit.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { logBusinessEvent } from "../logger/business.js";

export const reviewsRouter = new Hono<AuthEnv>();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

class ReviewError extends Error {
  statusCode: number;
  code: string;

  constructor(
    message: string,
    statusCode: number = 400,
    code: string = ERROR_CODES.VALIDATION_FAILED
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface CreateReviewParams {
  authorId: string;
  tripId: string;
  targetUserId: string;
  targetRole: string;
  rating: number;
  text: string;
  tripRoute: string;
}

/**
 * Создание отзыва в Serializable-транзакции.
 *
 * Отзыв создаётся со статусом "pending": рейтинг target-пользователя при
 * создании НЕ пересчитывается — пересчёт (recomputeUserRating) произойдёт
 * при одобрении отзыва админом.
 *
 * P2034 (serialization failure) — при параллельных записях в одни и те же
 * строки SSI-конфликт временный: повторяем транзакцию один раз. При true-дубле
 * сработает повторная проверка внутри транзакции или уникальные индексы
 * (Review_authorId_tripId_targetUserId_key для tripId NOT NULL,
 * Review_authorId_targetUserId_nullTrip_key для tripId IS NULL — F14)
 * с отловом P2002 → 409.
 */
async function createReviewTransaction(params: CreateReviewParams) {
  const run = () =>
    db.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({ where: { id: params.tripId } });
        if (!trip || trip.status === "cancelled") {
          throw new ReviewError("Trip is no longer reviewable", 400, ERROR_CODES.TRIP_NOT_ACTIVE);
        }

        const authorIsDriver = trip.driverId === params.authorId;
        const targetIsDriver = trip.driverId === params.targetUserId;
        if (authorIsDriver === targetIsDriver) {
          throw new ReviewError(
            "Reviews must be between driver and passenger",
            403,
            ERROR_CODES.FORBIDDEN,
          );
        }

        if (!authorIsDriver || !targetIsDriver) {
          const participant = await tx.booking.findFirst({
            where: {
              tripId: params.tripId,
              passengerId: authorIsDriver ? params.targetUserId : params.authorId,
              status: "confirmed",
            },
          });
          if (!participant) {
            throw new ReviewError("Review participant is not confirmed", 403, ERROR_CODES.NOT_PARTICIPANT);
          }
        }

        // Повторная проверка внутри транзакции с Serializable-изоляцией:
        // при параллельных запросах уникальные индексы
        // (Review_authorId_tripId_targetUserId_key + F14-partial для NULL tripId)
        // и отлов P2002 гарантируют отсутствие дублей.
        const duplicate = await tx.review.findFirst({
          where: {
            authorId: params.authorId,
            tripId: params.tripId,
            targetUserId: params.targetUserId,
          },
        });

        if (duplicate) {
          throw new ReviewError(
            "You already reviewed this user for this trip",
            409,
            ERROR_CODES.ALREADY_REVIEWED
          );
        }

        const created = await tx.review.create({
          data: {
            authorId: params.authorId,
            targetUserId: params.targetUserId,
            targetRole: params.targetRole,
            rating: params.rating,
            text: params.text,
            tripRoute: params.tripRoute,
            status: "pending", // публикуется после одобрения модерацией
            tripId: params.tripId,
          },
          include: {
            author: true,
          },
        });

        // Рейтинг target-пользователя намеренно НЕ пересчитывается: отзыв
        // в статусе "pending" в рейтинг не входит, пересчёт (общая логика
        // recomputeUserRating) произойдёт при одобрении админом.

        return created;
      },
      { isolationLevel: "Serializable" }
    );

  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return await run();
    }
    throw error;
  }
}

/**
 * Отзывы, оставленные текущим пользователем.
 */
reviewsRouter.get("/my", requireUser, reviewsReadLimiter, async (c) => {
  const user = c.get("user");

  const reviews = await db.review.findMany({
    where: {
      authorId: user.id,
    },
    include: {
      author: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return c.json(
    reviews.map((review) => ({
      ...serializeReview(review),
      tripId: review.tripId ?? undefined,
    }))
  );
});

/**
 * Поездки, доступные текущему пользователю для отзыва.
 *
 * Логика:
 * - пользователь был пассажиром (бронь подтверждена) ИЛИ водителем
 *   (в поездке есть подтверждённые пассажиры);
 * - поездка не отменена;
 * - поездка уже прошла;
 * - пользователь еще не оставлял отзыв по этой поездке.
 */
reviewsRouter.get("/available-trips", requireUser, reviewsReadLimiter, async (c) => {
  const user = c.get("user");
  const now = new Date();

  const passengerBookings = await db.booking.findMany({
    where: {
      passengerId: user.id,
      status: "confirmed",
      trip: {
        status: {
          not: "cancelled",
        },
        departureAt: {
          lt: now,
        },
      },
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
    },
    orderBy: {
      trip: {
        departureAt: "desc",
      },
    },
  });

  // Поездки, где пользователь был водителем (с подтверждёнными пассажирами),
  // — чтобы водитель мог оставить отзыв о пассажирах.
  const driverTrips = await db.trip.findMany({
    where: {
      driverId: user.id,
      status: {
        not: "cancelled",
      },
      departureAt: {
        lt: now,
      },
      bookings: {
        some: {
          status: "confirmed",
        },
      },
    },
    include: {
      driver: {
        include: {
          car: true,
        },
      },
      bookings: {
        where: { status: "confirmed" },
        select: { passengerId: true },
      },
    },
    orderBy: {
      departureAt: "desc",
    },
  });

  const tripIds = Array.from(
    new Set([
      ...passengerBookings.map((b) => b.tripId),
      ...driverTrips.map((t) => t.id),
    ])
  );

  if (tripIds.length === 0) {
    return c.json([]);
  }

  const existingReviews = await db.review.findMany({
    where: {
      authorId: user.id,
      tripId: {
        in: tripIds,
      },
    },
    select: {
      tripId: true,
      targetUserId: true,
    },
  });

  const reviewedTargets = new Set(
    existingReviews
      .filter((review): review is typeof review & { tripId: string } => Boolean(review.tripId))
      .map((review) => `${review.tripId}:${review.targetUserId}`)
  );

  const availableTripsMap = new Map<string, TripWithDriver>();

  for (const booking of passengerBookings) {
    if (!reviewedTargets.has(`${booking.tripId}:${booking.trip.driverId}`)) {
      availableTripsMap.set(booking.tripId, booking.trip);
    }
  }

  for (const trip of driverTrips) {
    if (trip.bookings.some((booking) => !reviewedTargets.has(`${trip.id}:${booking.passengerId}`))) {
      availableTripsMap.set(trip.id, trip);
    }
  }

  const availableTrips = Array.from(availableTripsMap.values());

  return c.json(availableTrips.map((trip) => serializeTrip(trip)));
});

/**
 * Публичный список отзывов о пользователе (cursor-based пагинация).
 *
 * Возвращает только опубликованные отзывы (status = "published"):
 * pending (на модерации) и rejected (отклонённые) скрыты от публики.
 *
 * Query params:
 * - `limit` (optional): количество отзывов на страницу (1-50, default 20)
 * - `cursor` (optional): ID последнего элемента предыдущей страницы
 *
 * Response: { items: Review[], pagination: { nextCursor, hasMore, limit } }
 */
reviewsRouter.get("/user/:userId", publicReadLimiter, async (c) => {
  const userId = c.req.param("userId");

  const targetUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!targetUser) {
    return c.json({ message: "User not found" }, 404);
  }

  // === Пагинация ===
  const limitParam = Number.parseInt(
    c.req.query("limit") ?? String(DEFAULT_PAGE_LIMIT),
    10
  );
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;

  const cursorStr = c.req.query("cursor");
  let cursor: string | undefined;

  if (cursorStr) {
    // Строгая валидация UUID — защита от инъекций и ошибок Prisma.
    if (!UUID_REGEX.test(cursorStr)) {
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid cursor format" },
        400
      );
    }
    cursor = cursorStr;
  }

  // Берём limit + 1, чтобы понять, есть ли следующая страница.
  // Валидный cursor на конце списка — пустая страница (200), не 400.
  const reviews = await db.review.findMany({
    where: {
      targetUserId: userId,
      status: "published", // модерация: публичный список — только опубликованные
    },
    take: limit + 1,
    skip: cursor ? 1 : 0, // Пропускаем сам cursor-элемент (уже отдан на прошлой странице)
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id-tiebreaker: стабильный порядок
    include: {
      author: true,
    },
  });

  const hasMore = reviews.length > limit;
  const items = hasMore ? reviews.slice(0, limit) : reviews;
  const nextCursor =
    hasMore && items.length > 0 ? items[items.length - 1].id : null;

  const response = {
    items: items.map(serializeReview),
    pagination: { nextCursor, hasMore, limit },
  };

  // Runtime-валидация ответа: ловим contract drift всегда, не только в dev.
  const validation = paginatedReviewsResponseSchema.safeParse(response);
  if (!validation.success) {
    logger.warn(
      { issues: validation.error.issues, userId },
      "reviews_pagination_response_validation_failed"
    );
    return c.json(
      { code: ERROR_CODES.INTERNAL_ERROR, message: "Invalid reviews response" },
      500
    );
  }

  return c.json(validation.data);
});

/**
 * Создание отзыва.
 *
 * Правила:
 * - автор = текущий пользователь;
 * - нельзя оставить отзыв самому себе;
 * - поездка должна существовать;
 * - поездка не должна быть отменённой;
 * - поездка должна уже начаться/пройти;
 * - автор и target должны быть участниками поездки;
 * - нельзя оставить повторный отзыв тому же пользователю по той же поездке;
 * - отзыв создаётся со статусом "pending": публичная видимость — после
 *   одобрения модерацией, рейтинг target-пользователя при создании не меняется.
 */
reviewsRouter.post("/", requireUser, mutationLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = createReviewDtoSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      { message: "Invalid payload", errors: z.formatError(parseResult.error) },
      400
    );
  }

  const { tripId, targetUserId, rating, text } = parseResult.data;

  const author = c.get("user");

  if (author.id === targetUserId) {
    return c.json({ code: ERROR_CODES.SELF_REVIEW, message: "Cannot review yourself" }, 400);
  }

  const [targetUser, trip] = await Promise.all([
    db.user.findUnique({
      where: { id: targetUserId },
    }),
    db.trip.findUnique({
      where: { id: tripId },
    }),
  ]);

  if (!targetUser) {
    return c.json({ code: ERROR_CODES.NOT_FOUND, message: "Target user not found" }, 404);
  }

  if (!trip) {
    return c.json({ code: ERROR_CODES.NOT_FOUND, message: "Trip not found" }, 404);
  }

  if (trip.status === "cancelled") {
    return c.json({ code: ERROR_CODES.TRIP_NOT_ACTIVE, message: "Trip is cancelled" }, 400);
  }

  const now = new Date();
  const isTripCompleted = trip.status === "completed";
  const isTripPast = trip.departureAt <= now;

  if (!isTripCompleted && !isTripPast) {
    return c.json(
      { code: ERROR_CODES.TRIP_IN_PAST, message: "Trip has not started or completed yet" },
      400
    );
  }

  if (trip.status === "active" && isTripPast) {
    logger.warn(
      { tripId: trip.id },
      "Review for non-completed past trip"
    );
  }

  /**
   * Проверяем, что автор отзыва участвовал в поездке.
   */
  const isAuthorDriver = trip.driverId === author.id;

  if (!isAuthorDriver) {
    const authorBooking = await db.booking.findFirst({
      where: {
        tripId: trip.id,
        passengerId: author.id,
        status: "confirmed",
      },
    });

    if (!authorBooking) {
      return c.json(
        { code: ERROR_CODES.NOT_PARTICIPANT, message: "You did not participate in this trip" },
        403
      );
    }
  }

  /**
   * Проверяем, что target-пользователь участвовал в поездке.
   */
  const isTargetDriver = trip.driverId === targetUserId;

  if (isAuthorDriver === isTargetDriver) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Reviews must be between driver and passenger" },
      403,
    );
  }

  if (!isTargetDriver) {
    const targetBooking = await db.booking.findFirst({
      where: {
        tripId: trip.id,
        passengerId: targetUserId,
        status: "confirmed",
      },
    });

    if (!targetBooking) {
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "Target user did not participate in this trip" },
        400
      );
    }
  }

  const targetRole = isTargetDriver ? "driver" : "passenger";
  const tripRoute = `${trip.fromCity} → ${trip.toCity}`;

  /**
   * Запрещаем повторный отзыв тому же пользователю по той же поездке.
   * Быстрый путь для уже существующего отзыва (без Serializable-транзакции).
   */
  const existingReview = await db.review.findFirst({
    where: {
      authorId: author.id,
      tripId: trip.id,
      targetUserId,
    },
  });

  if (existingReview) {
    return c.json(
      { code: ERROR_CODES.ALREADY_REVIEWED, message: "You already reviewed this user for this trip" },
      409
    );
  }

  try {
    const review = await createReviewTransaction({
      authorId: author.id,
      tripId: trip.id,
      targetUserId,
      targetRole,
      rating,
      text,
      tripRoute,
    });

    logBusinessEvent("review.created", {
      reviewId: review.id,
      authorId: author.id,
      targetUserId,
      rating,
      tripId: trip.id,
    });

    return c.json(serializeReview(review), 201);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      // SSI-конфликт повторился после ретрая: параллельная запись
      // (второй отзыв той же пары / конкурентный пересчёт) не дала
      // транзакции подтвердиться. Это временный конфликт записи —
      // 409 с retryable:true (security-audit §4: P2034 → 409,
      // never 503 INTERNAL_ERROR), клиент повторяет запрос.
      return c.json(
        { code: ERROR_CODES.CONFLICT, message: "Concurrent update conflict, please retry", retryable: true },
        409
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Уникальный индекс сработал: параллельный запрос уже создал отзыв.
      return c.json(
        { code: ERROR_CODES.ALREADY_REVIEWED, message: "You already reviewed this user for this trip" },
        409
      );
    }

    if (error instanceof ReviewError) {
      return c.json(
        { code: error.code, message: error.message },
        error.statusCode as ContentfulStatusCode
      );
    }

    logger.error(
      {
        err: error,
        endpoint: "POST /api/reviews",
      },
      "review_create_failed"
    );
    reportServerError(error, c.req.method, c.req.path);

    return c.json({ message: "Internal server error" }, 500);
  }
});
