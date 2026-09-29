import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { db } from "../db.js";
import type { AuthEnv } from "../auth/middleware.js";
import { logger } from "../logger.js";
import { cancelBookingLimiter } from "../middleware/rateLimit.js";
import { ERROR_CODES } from "../errors.js";
import { BookingError } from "./shared.js";
import { logBusinessEvent } from "../logger/business.js";
import { wsManager } from "../ws/manager.js";

export const cancelRouter = new Hono<AuthEnv>();

/**
 * Отмена брони пассажиром.
 *
 * Правила:
 * - отменять может только пассажир, который создал бронь;
 * - отменять можно только pending/confirmed;
 * - поездка должна быть active;
 * - активная бронь освобождает место.
 */
cancelRouter.patch("/:id/cancel", cancelBookingLimiter, async (c) => {
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
