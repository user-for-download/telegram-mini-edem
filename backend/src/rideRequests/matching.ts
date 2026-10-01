import type { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import {
  notifyUser,
  tripSnapshotOf,
} from "../services/notification.service.js";

type TripForMatching = Pick<
  Prisma.TripGetPayload<Prisma.TripDefaultArgs>,
  | "id"
  | "driverId"
  | "fromCity"
  | "toCity"
  | "price"
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

  // Имя водителя для второй строки ячеек — один запрос на подборку.
  const driver = await db.user.findUnique({
    where: { id: trip.driverId },
    select: { name: true },
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
    // M4: live-hint инбокса, как у остальных типов (раньше match приходил
    // только через stale/refetch). Hint — внутри notifyUser, только если
    // запись создана.
    await notifyUser({
      userId: request.userId,
      type,
      title: "Подходящая поездка",
      body,
      fragment: `/trips/${trip.id}`,
      // Вторая строка — «имя • действие», третья — снапшот поездки.
      actorName: driver?.name,
      action: "matched",
      tripSnapshot: tripSnapshotOf(trip),
      // Получатель — автор запроса (потенциальный пассажир).
      role: "passenger",
    });
  }
}
