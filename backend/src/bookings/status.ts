import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  updateBookingStatusDtoSchema,
  isActiveBookingStatus,
} from "@edem/contracts";
import { db } from "../db.js";
import type { AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import { reportServerError } from "../client-errors/index.js";
import { serializeBooking } from "../serializers/index.js";
import { createUserRateLimiter } from "../middleware/rateLimit.js";
import { devRateMax } from "../env.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { activeBookingWhere, BookingError } from "./shared.js";
import { logBusinessEvent } from "../logger/business.js";
import { createNotification } from "../services/notification.service.js";
import { wsManager } from "../ws/manager.js";

export const statusRouter = new Hono<AuthEnv>();

const bookingDecisionLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: devRateMax(100),
  keyPrefix: "driver-booking-decision",
});

/**
 * Смена статуса брони водителем.
 * pending/confirmed считаются активным удержанием места.
 * declined освобождает место.
 */
statusRouter.patch("/:id/status", bookingDecisionLimiter, async (c) => {
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
    reportServerError(error, c.req.method, c.req.path);

    return c.json({ message: "Internal server error" }, 500);
  }
});
