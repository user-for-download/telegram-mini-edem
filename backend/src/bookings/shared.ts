import { Prisma } from "../generated/prisma/client.js";
import { ERROR_CODES } from "../errors.js";

export { createUserRateLimiter } from "../middleware/rateLimit.js";

export type HttpStatus = 400 | 403 | 404 | 409;

export class BookingError extends Error {
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

export type BookingFull = Prisma.BookingGetPayload<{
  include: {
    trip: { include: { driver: { include: { car: true } } } };
    passenger: { include: { car: true } };
  };
}>;

export type CreateResult =
  | { kind: "created"; booking: BookingFull }
  | { kind: "idempotent"; booking: BookingFull };

/**
 * Пагинация заявок на поездку (GET /bookings/trip/:tripId).
 * nextCursor — id последней заявки страницы; null означает конец списка.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_BOOKINGS_LIMIT = 50;
export const MAX_BOOKINGS_LIMIT = 50;
export const PENDING_BOOKING_TTL_MS = 24 * 60 * 60 * 1000;

export function activeBookingWhere(
  now = new Date(),
): Prisma.BookingWhereInput {
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
export const IN_TX_EXPIRY_SWEEP_LIMIT = 20;

export async function releaseExpiredBookings(
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
