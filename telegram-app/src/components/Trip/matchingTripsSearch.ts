// telegram-app/src/components/Trip/matchingTripsSearch.ts
// Предотправочная проверка «а не едет ли кто-то уже»: собирает запрос
// активных поездок по маршруту и окну дат и достаёт из ответа одну карточку.
//
// Запрос идёт тем же GET /trips, что и лента поиска (fromCityId/toCityId/
// dateFrom/dateTo) — отдельного эндпоинта ради проверки нет: это тот же
// read-модельный вопрос «что уже есть», второй контракт означал бы две
// правды об одном. Активность и «не уехала» фильтрует сам бэкенд
// (status=active, departureAt > now), клиенту остаются маршрут и окно.
import { tripsApi, type SearchTripsFilters } from "@/api/trips.api";
import type { Trip } from "@edem/contracts";
import { moscowDayKey } from "@/utils/date";
import { log } from "@/utils/log";
import { plural } from "@/utils/plural";

/** Маршрут и окно дат формы — ровно те поля, из которых строится проверка. */
export interface RouteWindowDraft {
  /** id городов справочника, не имена. */
  fromCityId: string;
  toCityId: string;
  /** Значения datetime-local формы («YYYY-MM-DDTHH:mm»), локальные. */
  earliest: string;
  latest: string;
}

/**
 * Сколько поездок запрашиваем. Открываем всё равно одну, а число для текста
 * берём из `pagination.total` — лимит влияет только на то, какая поездка
 * попадёт в `items[0]`, и держит ответ маленьким.
 */
export const MATCHING_TRIPS_LIMIT = 5;

/** Маршрут карточки поездки — единственное место, где он собирается. */
export function tripCardRoute(tripId: string): string {
  return `/trips/${tripId}`;
}

/**
 * Фильтры GET /trips для проверки «есть ли уже поездки под эти условия».
 *
 * null — проверять нечем (маршрут не выбран / даты не разобрались): тогда
 * заявка создаётся как обычно, а не падает. Ошибки валидации формы до этого
 * места не доходят — их ставит `buildRideRequestDraft`.
 *
 * Даты — календарные дни ПО МОСКВЕ (`moscowDayKey`): бэкенд разбирает
 * dateFrom/dateTo как границы московских суток, поэтому локальный день
 * устройства в поясах западнее Москвы уехал бы на сутки назад и проверка
 * искала бы несуществующее окно.
 */
export function buildMatchingTripsQuery(
  draft: RouteWindowDraft,
): SearchTripsFilters | null {
  if (!draft.fromCityId || !draft.toCityId) return null;
  const earliest = new Date(draft.earliest);
  const latest = new Date(draft.latest);
  if (!Number.isFinite(earliest.getTime())) return null;
  if (!Number.isFinite(latest.getTime())) return null;
  return {
    fromCityId: draft.fromCityId,
    toCityId: draft.toCityId,
    dateFrom: moscowDayKey(earliest),
    dateTo: moscowDayKey(latest),
    page: 1,
    limit: MATCHING_TRIPS_LIMIT,
  };
}

/**
 * Поездка, в которую есть смысл вести: со свободными местами, иначе первая.
 *
 * Бэкенд места не фильтрует (в ленте полная поездка тоже показывается), но
 * «открыть поездку без мест» — тупик, поэтому при наличии такой выбираем её.
 */
export function pickMatchingTrip(items: readonly Trip[]): Trip | null {
  return items.find((trip) => trip.seatsAvailable > 0) ?? items[0] ?? null;
}

/**
 * Текст информирующего диалога: сколько поездок уже есть по маршруту.
 *
 * Склонение через `plural`, а не конкатенация: «1 активная поездка» против
 * «3 активные поездки» — иначе диалог врал бы на числе.
 */
export function matchingTripMessage(routeLabel: string, total: number): string {
  const count = `${total} ${plural(
    total,
    "активная поездка",
    "активные поездки",
    "активных поездок",
  )}`;
  return `По маршруту ${routeLabel} уже есть ${count}. Открыть поездку вместо заявки?`;
}

/**
 * Первая подходящая поездка + их количество, либо null.
 *
 * Сбой сети или ответа — это null, а не исключение: проверка информирующая,
 * и тихо её пропустить дешевле, чем не дать человеку создать заявку.
 */
export async function findMatchingTrip(
  draft: RouteWindowDraft,
): Promise<{ trip: Trip; total: number } | null> {
  const filters = buildMatchingTripsQuery(draft);
  if (filters === null) return null;
  const page = await tripsApi.getTrips(filters).catch((error: unknown) => {
    log("[ride-request] предпроверка поездок не удалась", error);
    return null;
  });
  if (page === null) return null;
  const trip = pickMatchingTrip(page.items);
  if (trip === null) return null;
  return { trip, total: page.pagination.total };
}
