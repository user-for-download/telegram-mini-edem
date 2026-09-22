import type { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { createNotification } from "../services/notification.service.js";

type TripForMatching = Pick<
  Prisma.TripGetPayload<Prisma.TripDefaultArgs>,
  | "id"
  | "driverId"
  | "fromCityId"
  | "toCityId"
  | "departureAt"
  | "durationMinutes"
>;

/**
 * Структурированный маркер привязки match-уведомления к поездке.
 * Держим как константу вместо free-text: и тело уведомления, и dedup-запрос
 * строятся из неё — расхождение форматов исключено. `contains` (а не
 * startsWith) сохранён намеренно: старые уведомления, записанные до введения
 * константы, тоже должны находиться при дедупликации.
 */
export const MATCH_NOTIFY_TRIP_ID_MARKER = "ID: ";

/** Notify each matching requester once per trip without creating a booking. */
export async function notifyMatchingRideRequests(
  trip: TripForMatching,
): Promise<void> {
  if (!trip.fromCityId || !trip.toCityId) return;

  const tripEnd = new Date(
    trip.departureAt.getTime() + trip.durationMinutes * 60_000,
  );
  const requests = await db.rideRequest.findMany({
    where: {
      userId: { not: trip.driverId },
      fromCityId: trip.fromCityId,
      toCityId: trip.toCityId,
      status: "active",
      expiresAt: { gt: new Date() },
      earliestAt: { lte: tripEnd },
      latestAt: { gte: trip.departureAt },
    },
    select: { id: true, userId: true },
    // Детерминированный порядок + лимит: один вызов — один проход по самым
    // ранним активным запросам. Без orderBy повторные вызовы при >50
    // совпадениях уведомляли бы случайное подмножество.
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  for (const request of requests) {
    const type = "ride_request_match";
    const body = `Нашлась подходящая поездка для вашего запроса. Откройте поездку и отправьте заявку на бронирование. ${MATCH_NOTIFY_TRIP_ID_MARKER}${trip.id}`;
    const duplicate = await db.notification.findFirst({
      where: {
        userId: request.userId,
        type,
        body: { contains: `${MATCH_NOTIFY_TRIP_ID_MARKER}${trip.id}` },
      },
      select: { id: true },
    });
    if (duplicate) continue;
    await createNotification(
      request.userId,
      type,
      "Подходящая поездка",
      body,
      `/trips/${trip.id}`,
    );
  }
}
