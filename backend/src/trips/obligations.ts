import type { Prisma } from "../generated/prisma/client.js";
import { activeBookingWhere } from "../bookings/shared.js";
import { getTripRange, rangesOverlap, type TimeRange } from "../utils/overlap.js";

/** A person cannot travel simultaneously as a driver and as a passenger. */
export async function hasTravelOverlap(
  tx: Prisma.TransactionClient,
  userIds: string[],
  range: TimeRange,
  excludedTripId?: string,
): Promise<boolean> {
  if (userIds.length === 0) return false;
  const trips = await tx.trip.findMany({
    where: {
      status: "active",
      ...(excludedTripId ? { id: { not: excludedTripId } } : {}),
      departureAt: { lt: range.end },
      OR: [
        { driverId: { in: userIds } },
        { bookings: { some: { passengerId: { in: userIds }, ...activeBookingWhere() } } },
      ],
    },
    select: { departureAt: true, durationMinutes: true },
  });
  return trips.some((trip) =>
    rangesOverlap(range, getTripRange(trip.departureAt, trip.durationMinutes)),
  );
}
