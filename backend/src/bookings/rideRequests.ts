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

function ownedMatchingWhere(trip: TripRouteWindow, passengerId: string) {
  const route = withRoute(trip);
  if (!route) return null;
  const where = matchingRideRequestWhere(route);
  // Existing reservations survive peer blocks; fulfillment concerns only the owner's search.
  delete where.user;
  return { ...where, userId: passengerId };
}

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
 * иначе закрытие служило бы оракулом существования чужих заявок — тем же
 * свойством, ради которого шаг приглашения снят 2026-10-09.
 */
async function findClientRequest(
  tx: Prisma.TransactionClient,
  params: { requestId: string; passengerId: string; trip: TripRouteWindow },
) {
  const where = ownedMatchingWhere(params.trip, params.passengerId);
  if (!where) return null;

  return tx.rideRequest.findFirst({
    where: {
      ...where,
      id: params.requestId,
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
  const where = ownedMatchingWhere(params.trip, params.passengerId);
  if (!where) return [];

  return tx.rideRequest.findMany({
    where,
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

/** Validate the explicit client choice without closing a still-pending ride search. */
export async function prepareRideRequestForBooking(
  tx: Prisma.TransactionClient,
  params: { trip: TripRouteWindow; passengerId: string; requestedRequestId?: string },
): Promise<string | null> {
  if (params.requestedRequestId === undefined) return null;
  const request = await findClientRequest(tx, {
    requestId: params.requestedRequestId, passengerId: params.passengerId, trip: params.trip,
  });
  if (!request) throw new BookingError("Ride request not found", 404, ERROR_CODES.NOT_FOUND);
  return request.id;
}

/** Fulfill owned matching requests in the same transaction as booking confirmation. */
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
    // The passenger may have paused/cancelled/edited the search while awaiting a decision.
    if (!client) return { stampedRequestId: null, closedIds: [] };
    await fulfill(tx, [client.id]);
    return { stampedRequestId: client.id, closedIds: [client.id] };
  }

  const matching = await findMatchingRequests(tx, { passengerId, trip });
  const closedIds = matching.map((request) => request.id);
  await fulfill(tx, closedIds);

  // Активных заявок нет — обычная бронь, закрывать нечего.
  return { stampedRequestId: closedIds[0] ?? null, closedIds };
}
