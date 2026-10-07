import type { Prisma } from "../generated/prisma/client.js";

export type RideRequestWithCities = Prisma.RideRequestGetPayload<{
  include: { fromCity: true; toCity: true };
}>;

/**
 * Города нужны в КАЖДОМ ответе по заявке (сериализатор читает их имена), поэтому
 * форма включения живёт здесь, рядом с типом результата, а не дублируется по
 * месту вызова: разъехавшийся `include` тихо ломает сериализатор.
 */
export const rideRequestIncludeCities = {
  fromCity: true,
  toCity: true,
} as const;

export function serializeRideRequest(request: RideRequestWithCities) {
  return {
    id: request.id,
    fromCity: { id: request.fromCity.id, name: request.fromCity.name },
    toCity: { id: request.toCity.id, name: request.toCity.name },
    earliestAt: request.earliestAt.toISOString(),
    latestAt: request.latestAt.toISOString(),
    seats: request.seats,
    status: request.status,
    expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}
