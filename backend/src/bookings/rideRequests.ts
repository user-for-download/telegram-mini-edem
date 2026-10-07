import type { Prisma } from "../generated/prisma/client.js";
import {
  matchingRideRequestWhere,
  withRoute,
  type TripRouteWindow,
} from "../rideRequests/matching.js";
import { ERROR_CODES } from "../errors.js";
import { BookingError } from "./shared.js";

/**
 * Статус, в который уходит заявка, закрытая фактом состоявшейся брони.
 * Тот же статус, что ставит мутация `PATCH /ride-requests/:id/status`.
 */
const FULFILLED = "fulfilled";

/**
 * Сколько совпавших заявок закрывает одна бронь.
 *
 * Квота активных заявок на человека — три (`POST /ride-requests`), поэтому
 * лимит недостижим и существует только ради того, чтобы Serializable-
 * транзакция не поехала по неограниченной выборке. Обрезанные заявки не
 * «забываются»: они остаются активными и попадут в подбор следующей поездки.
 */
const MAX_CLOSED_REQUESTS = 10;

/** Итог закрытия заявок при одной брони. */
export type ClosedRideRequests = {
  /** Заявка, которую проставляем в `Booking.requestId` (одна на бронь). */
  stampedRequestId: string | null;
  /** Все закрытые заявки — ради бизнес-лога и тестов. */
  closedIds: string[];
};

/**
 * Закрывает заявку клиента, только если она его и действительно подходит под
 * поездку. Проверка — тем же предикатом `matchingRideRequestWhere`, что у
 * подбора и `GET /trips/:id/requests`, плюс владелец.
 *
 * Несуществующая, чужая, неактивная и не подходящая заявки неразличимы (404):
 * иначе эндпоинт служил бы оракулом существования чужих заявок — ровно как в
 * `POST /ride-requests/:id/invite`.
 */
async function findClientRequest(
  tx: Prisma.TransactionClient,
  params: { requestId: string; passengerId: string; trip: TripRouteWindow },
) {
  const route = withRoute(params.trip);
  if (!route) return null;

  return tx.rideRequest.findFirst({
    where: {
      // Порядок КРИТИЧЕН: спред идёт ПЕРВЫМ. `matchingRideRequestWhere`
      // возвращает `userId: { not: driverId }`, и раскладка после равенства
      // `userId` затирала бы его — поиск нашёл бы чужую заявку, и бронь
      // одного пассажира закрыла бы пожелание другого.
      ...matchingRideRequestWhere(route),
      id: params.requestId,
      // Владелец — равенство, а не «не водитель»: закрывать можно только
      // собственную заявку пассажира.
      userId: params.passengerId,
    },
    select: { id: true },
  });
}

/**
 * Все активные заявки пассажира, подходящие под поездку (маршрут + окно).
 *
 * Порядок `createdAt asc` определяет, какая из них станет «витринной» в
 * `Booking.requestId`: самая ранняя — её пассажир носил дольше всего.
 */
function findMatchingRequests(
  tx: Prisma.TransactionClient,
  params: { passengerId: string; trip: TripRouteWindow },
) {
  const route = withRoute(params.trip);
  if (!route) return [];

  return tx.rideRequest.findMany({
    where: {
      // Спред первым: его `userId: { not: driverId }` не должен затирать
      // равенство владельца ниже (см. findClientRequest).
      ...matchingRideRequestWhere(route),
      userId: params.passengerId,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: MAX_CLOSED_REQUESTS,
  });
}

/**
 * Переводит заявки в `fulfilled` одним `updateMany` с проверкой числа строк.
 *
 * `status: "active"` в предикате — не оптимизация, а гонка: заявку могли
 * закрыть/отменить между чтением и записью. Расхождение `count` означает, что
 * состояние уже не то, что мы проверили, поэтому транзакция обязана откатиться
 * (вызывающий бросает BookingError) — пассажир не должен получить «бронь есть,
 * заявка висит».
 */
async function fulfill(
  tx: Prisma.TransactionClient,
  requestIds: string[],
): Promise<void> {
  if (requestIds.length === 0) return;

  const closed = await tx.rideRequest.updateMany({
    where: { id: { in: requestIds }, status: "active" },
    data: { status: FULFILLED },
  });

  if (closed.count !== requestIds.length) {
    throw new BookingError(
      "Ride request was just changed",
      409,
      ERROR_CODES.CONFLICT,
    );
  }
}

/**
 * Слой 2 «заявка → поездка»: бронь закрывает заявку, из которой выросла, и
 * получает её id в `Booking.requestId`.
 *
 * Вызывается ИЗНУТРИ той же транзакции, что и `booking.create`. Вне неё
 * пассажир получил бы «бронь подтверждена, заявка висит» — состояние, которого
 * в продукте быть не должно (см. Layer 2 в плане 2026-10-07-ride-request-intersection).
 *
 * Правила отбора (осознанные, не «как получится»):
 *
 * 1. Клиентский `requestId` — приоритетный: закрывается ровно та заявка,
 *    которую назвал клиент, после проверки владельца, активности и совпадения
 *    по предикату. Остальные заявки пассажира остаются активными: клиент
 *    выбрал конкретную, и догадываться за него — значит закрыть то, что он
 *    закрывать не собирался.
 * 2. Без `requestId` сервер закрывает ВСЕ совпавшие активные заявки
 *    пассажира. Каждая из них — пожелание «посади меня в это окно по этому
 *    маршруту», и одна бронь это окно удовлетворяет; оставлять такую заявку
 *    активной значило бы второй раз показать человеку в «Моих заявках» то,
 *    что он уже уехал. В `Booking.requestId` идёт самая ранняя по `createdAt`
 *    (детерминированно, а не «какая попалась»).
 * 3. Условия совпадения берутся из `matchingRideRequestWhere` — своей копии
 *    здесь быть не может, иначе «что закрылось» разошлось бы с «что показали
 *    в уведомлениях».
 * 4. Пассажир без заявок (обычный случай) — no-op: пустой массив, пустой
 *    `updateMany`, `stampedRequestId: null`. Не ошибка.
 *
 * Про просроченные (`expiresAt <= now`) заявки: предикат их отсекает, поэтому
 * автозакрытие их не трогает — закрывать нечего, просроченная заявка и так
 * выпадает из подбора.
 *
 * Про `seats` заявки: не сверяется с запрошенным местом. Заявка — пожелание о
 * маршруте и окне, а не бронь конкретного места; место пассажир выбирает сам.
 */
export async function closeRideRequestsForBooking(
  tx: Prisma.TransactionClient,
  params: {
    trip: TripRouteWindow;
    passengerId: string;
    requestedRequestId?: string;
  },
): Promise<ClosedRideRequests> {
  const { trip, passengerId, requestedRequestId } = params;

  if (requestedRequestId !== undefined) {
    const client = await findClientRequest(tx, {
      requestId: requestedRequestId,
      passengerId,
      trip,
    });
    if (!client) {
      throw new BookingError(
        "Ride request not found",
        404,
        ERROR_CODES.NOT_FOUND,
      );
    }
    await fulfill(tx, [client.id]);
    return { stampedRequestId: client.id, closedIds: [client.id] };
  }

  const matching = await findMatchingRequests(tx, { passengerId, trip });
  const closedIds = matching.map((request) => request.id);
  await fulfill(tx, closedIds);

  // Активных заявок нет — обычная бронь, закрывать нечего.
  return { stampedRequestId: closedIds[0] ?? null, closedIds };
}
