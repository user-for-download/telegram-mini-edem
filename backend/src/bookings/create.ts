import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { createBookingDtoSchema } from "@edem/contracts";
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
import { closeRideRequestsForBooking } from "./rideRequests.js";
import { logBusinessEvent } from "../logger/business.js";
import { domainEvents } from "../events/domainEvents.js";
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

  const { tripId, seat, comment, requestId } = parseResult.data;
  const passenger = c.get("user");

  try {
    const result: CreateResult = await db.$transaction(
      async (tx) => {
        const now = new Date();
        await releaseExpiredBookings(tx, now);
        // Адресный добор по этой поездке: глобальный sweep выше берёт лишь
        // top-20 старейших просрочек, поэтому просроченный pending именно
        // этой поездки мог остаться и держать partial-unique-индекс
        // (status IN 'pending','confirmed'), хотя activeBookingWhere() его
        // уже не считает активным — тогда INSERT падал бы P2002 «на мёртвой
        // строке» (ложный 409 SEAT_TAKEN чужому пассажиру или возврат
        // просроченной брони как 200).
        await releaseExpiredBookings(tx, now, { tripId, limit: 100 });
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

        // Слот занят, только если на нём висит активная (не истёкшая) бронь.
        // declined/cancelled, как и просроченный pending, слот освобождают —
        // поэтому предикат — общий expiry-aware activeBookingWhere().
        const seatConflict = await tx.booking.findFirst({
          where: {
            tripId,
            seat,
            ...activeBookingWhere(),
          },
          select: { id: true, passengerId: true },
        });

        // Псевдо-идемпотентность проверяется ДО guard'а остатка мест (F3).
        // Первая, реально прошедшая попытка уже списала одно место, поэтому
        // seatsAvailable на повторе может быть уже 0 (поездка на 1 место) —
        // и клиент, повторивший запрос после потерянного 201, получил бы 409
        // на собственную, уже существующую бронь. Возвращаем её с 200.
        // Ветка «слот занят кем-то ДРУГИМ» (SEAT_TAKEN) намеренно остаётся
        // ниже guard'а остатка: для чужих код/текст 409 не меняются.
        if (seatConflict?.passengerId === passenger.id) {
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

        // Остаток мест — только для действительно новых запросов: повтор
        // от того же пассажира выше уже разобран.
        if (trip.seatsAvailable <= 0) {
          throw new BookingError(
            "Not enough available seats",
            409,
            ERROR_CODES.CONFLICT,
          );
        }

        if (seatConflict) {
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
            seatsAvailable: { decrement: 1 },
          },
        });

        // Слой 2 «заявка → поездка»: заявка, породившая бронь, закрывается
        // ЗДЕСЬ, в той же Serializable-транзакции, что и booking.create.
        // Порядок именно такой: сначала закрытие (оно может бросить BookingError
        // и откатить всё), потом вставка брони. Обратный порядок оставил бы
        // пассажира с «бронь есть, заявка висит» при любой ошибке записи.
        //
        // Клиентский requestId приоритетнее серверного подбора; без него
        // сервер закрывает все совпавшие активные заявки сам. Правила и
        // обоснование — в closeRideRequestsForBooking.
        const closedRequests = await closeRideRequestsForBooking(tx, {
          trip,
          passengerId: passenger.id,
          ...(requestId !== undefined ? { requestedRequestId: requestId } : {}),
        });

        const created = await tx.booking.create({
          data: {
            tripId,
            passengerId: passenger.id,
            // Трассировка «бронь ← заявка». null — бронь без заявки (обычный
            // случай: человек забронировал, ни разу не создавая заявку).
            requestId: closedRequests.stampedRequestId,
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

        return {
          kind: "created",
          booking: created,
          closedRequestIds: closedRequests.closedIds,
        };
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

    // Уведомление водителю — через доменное событие: здесь только факты,
    // которые роут уже держит, а inbox-запись форматирует подписчик
    // (events/notificationSubscriber.ts). emit не бросает (ошибки
    // слушателей изолированы и логируются), await сохраняет прежний
    // порядок «сначала запись, потом ответ».
    await domainEvents.emit("booking.created", {
      bookingId: booking.id,
      tripId,
      seat,
      driverId: booking.trip.driverId,
      passengerName: booking.passenger.name,
      trip: {
        fromCity: booking.trip.fromCity,
        toCity: booking.trip.toCity,
        price: booking.trip.price,
        departureAt: booking.trip.departureAt,
      },
    });

    // Внешняя доставка водителю идёт через outbox→диспетчер (Bot API,
    // утверждён 2026-09-14). In-app запись выше + WS-hint ниже.

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
      // Предикат expiry-aware (как в pre-check'ах): просроченный pending
      // не отдаём клиенту как «активную бронь» — такое падение индекса
      // означает реальный конфликт, а не наш retry.
      if (constraintName === "active_seat_booking") {
        const existingBooking = await db.booking.findFirst({
          where: {
            tripId,
            seat,
            passengerId: passenger.id,
            ...activeBookingWhere(),
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
