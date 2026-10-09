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
  // Флаг подбора пассажиров. В типе он ОБЯЗАТЕЛЕН намеренно: без него
  // TypeScript не дал бы прочитать поле, и «undefined значит true» пришёл бы
  // из-под типов — то есть выключатель молча работал бы как включённый.
  | "matchingEnabled"
>;

/**
 * Структурированный маркер привязки match-уведомления к поездке.
 * Держим как константу вместо free-text: и тело уведомления, и dedup-запрос
 * строятся из неё — расхождение форматов исключено. `contains` (а не
 * startsWith) сохранён намеренно: старые уведомления, записанные до введения
 * константы, тоже должны находиться при дедупликации.
 */
export const MATCH_NOTIFY_TRIP_ID_MARKER = "ID: ";

/**
 * Поля поездки, которых достаточно подбору. Вынесены отдельно от полного
 * снимка `TripForMatching`: чтение спроса (`GET /trips/:id/requests`) не
 * работает со снимком и ценой, ему нужен только маршрут и окно.
 */
export type TripRouteWindow = Pick<
  TripForMatching,
  "driverId" | "fromCityId" | "toCityId" | "departureAt" | "durationMinutes"
>;

/** Поездка с обязательным справочником городов — иначе подбор невозможен. */
export type TripWithRoute = TripRouteWindow & {
  fromCityId: string;
  toCityId: string;
};

/**
 * Сужает поездку до подбора-eligible вида либо null, если у неё нет FK на
 * справочник городов (старые поездки, созданные до его появления — см.
 * `Trip.fromCityId` в схеме). Маршрут по снимкам строк не подставляем: подбор
 * по городу из строки дал бы ложные совпадения («Москва» ≠ «москва»).
 */
export function withRoute(trip: TripRouteWindow): TripWithRoute | null {
  if (!trip.fromCityId || !trip.toCityId) return null;
  return {
    driverId: trip.driverId,
    fromCityId: trip.fromCityId,
    toCityId: trip.toCityId,
    departureAt: trip.departureAt,
    durationMinutes: trip.durationMinutes,
  };
}

/**
 * ЕДИНЫЙ предикат подбора «заявки, подходящие поездке».
 *
 * Живёт здесь, а не в вызывающем коде, потому что у подбора две стороны:
 * уведомление пассажирам при создании поездки (notifyMatchingRideRequests) и
 * чтение спроса водителем (GET /trips/:id/requests). Расхождение условий
 * означало бы, что водителю показывается не тот спрос, о котором ему уже
 * написали в уведомлениях, — поэтому правило одно на оба вызова.
 *
 * Условия: тот же маршрут по справочнику, `active`, не просрочена, окно
 * заявки пересекает окно поездки (`earliestAt <= tripEnd && latestAt >=
 * departureAt`), и заявка НЕ от самого водителя — свой спрос водителю не
 * показываем (он и так знает, что едет).
 */
export function matchingRideRequestWhere(
  trip: TripWithRoute,
  now: Date = new Date(),
): Prisma.RideRequestWhereInput {
  const tripEnd = new Date(
    trip.departureAt.getTime() + trip.durationMinutes * 60_000,
  );
  return {
    userId: { not: trip.driverId },
    fromCityId: trip.fromCityId,
    toCityId: trip.toCityId,
    status: "active",
    expiresAt: { gt: now },
    earliestAt: { lte: tripEnd },
    latestAt: { gte: trip.departureAt },
  };
}

/** Notify each matching requester once per trip without creating a booking. */
export async function notifyMatchingRideRequests(
  trip: TripForMatching,
): Promise<void> {
  // Владелец поездки выключил подбор пассажиров → не предлагаем вовсе.
  // Первое из ТРЁХ мест гейта (уведомления здесь, чтение спроса и WS-хинт в
  // `rideRequests/index.ts`): пропуск любого даёт либо «уведомление есть, а
  // предложить нечего», либо «хинт привёл к пустой карточке».
  // Выход ДО выборки заявок и ДО запроса имени водителя: при выключенном
  // подборе не должно быть даже чтения, не то чтобы записей.
  if (!trip.matchingEnabled) return;

  const route = withRoute(trip);
  if (!route) return;

  const requests = await db.rideRequest.findMany({
    where: matchingRideRequestWhere(route),
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
