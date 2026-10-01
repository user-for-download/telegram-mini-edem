import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  createBookingDtoSchema,
  ACTIVE_BOOKING_STATUSES,
} from "@edem/contracts";
import { db } from "../db.js";
import type { AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import { reportServerError } from "../client-errors/index.js";
import { serializeBooking } from "../serializers/index.js";
import {
  mutationLimiter,
  createBookingLimiter,
} from "../middleware/rateLimit.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { getTripRange, rangesOverlap } from "../utils/overlap.js";
import { getUniqueConstraintName } from "../utils/prisma-errors.js";
import {
  activeBookingWhere,
  releaseExpiredBookings,
  PENDING_BOOKING_TTL_MS,
  BookingError,
  type CreateResult,
} from "./shared.js";
import { logBusinessEvent } from "../logger/business.js";
import {
  notifyUser,
  tripSnapshotOf,
} from "../services/notification.service.js";
import { wsManager } from "../ws/manager.js";

export const createRouter = new Hono<AuthEnv>();

/**
 * Создание брони пассажиром.
 * Статус всегда pending.
 * Pending сразу удерживает место.
 */
createRouter.post("/", mutationLimiter, createBookingLimiter, async (c) => {
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

    await notifyUser({
      userId: booking.trip.driverId,
      type: "booking_created",
      title: "Новая заявка на место",
      body: `Получена новая заявка на место ${seat} в поездке ${booking.trip.fromCity} → ${booking.trip.toCity}`,
      // Тап открывает шторку деталей поездки водителя.
      fragment: `/trips/${tripId}`,
      // Вторая строка — «имя • действие», третья — снапшот поездки.
      actorName: booking.passenger.name,
      action: "created",
      tripSnapshot: tripSnapshotOf(booking.trip),
      // Получатель — водитель поездки.
      role: "driver",
    });

    // Внешняя доставка водителю — только через утверждённый канал
    // (Bot API заблокирован, см. ADR). In-app запись выше + WS-hint ниже.

    wsManager.sendToUser(booking.trip.driverId, {
      type: "booking:new",
      payload: { bookingId: booking.id, tripId },
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
    reportServerError(error, c.req.method, c.req.path);

    return c.json({ message: "Internal server error" }, 500);
  }
});
