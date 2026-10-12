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
import { fromMoscowDateTimeInput, moscowDayKey } from "@/utils/date";
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
 * Подходит ли поездка под заявку — ПРЕДПРОВЕРКА, повторяющая предикат
 * бэкенда (`rideRequests/matching.ts` → matchingRideRequestWhere).
 *
 * Раньше здесь было одно условие «есть свободные места», и предпроверка
 * показывала поездки, на которые сервер заявку всё равно не подставил бы:
 *
 * - СВОЯ поездка. GET /trips не исключает текущего пользователя, поэтому
 *   водитель, который сам едет Вологда → Тула, получал отказ «уже есть
 *   активная поездка, открыть её вместо заявки?» и уходил в свою же карточку.
 *   Сервер здесь строже: `userId: { not: trip.driverId }`.
 * - Подбор выключен. `matchingEnabled: false` — водитель не хочет заявок,
 *   сервер выходит ДО выборки заявок; такую поездку предлагать нельзя.
 * - Временное пересечение. Сервер требует пересечения интервалов
 *   [поездка] и [заявка]; проверка по календарным дням ( moscowDayKey)
 *   ловила поездку, улетевшую за 15 часов до заявки.
 *
 * `userId` может быть пустым до загрузки профиля — тогда чужие поездки
 * предлагаются как обычно, просто свои не отфильтровываются.
 */
export function isMatchCandidate(
  trip: Trip,
  draft: RouteWindowDraft,
  userId: string | null,
): boolean {
  if (trip.matchingEnabled === false) return false;
  if (userId && trip.driver.id === userId) return false;
  const earliest = fromMoscowDateTimeInput(draft.earliest);
  const latest = fromMoscowDateTimeInput(draft.latest);
  const departureAt = Date.parse(trip.departureAt ?? "");
  if (earliest === null || latest === null || !Number.isFinite(departureAt)) {
    // Окно не разобралось — не отсекаем по времени, но и по маршруту/флагу
    // условия выше уже отсекли.
    return true;
  }
  const tripEnd = departureAt + trip.durationMinutes * 60_000;
  return earliest.getTime() <= tripEnd && latest.getTime() >= departureAt;
}

/**
 * Поездка, в которую есть смысл вести: подходящая по предикату сервера и
 * со свободными местами, иначе первая подходящая.
 *
 * Бэкенд места не фильтрует (в ленте полная поездка тоже показывается), но
 * «открыть поездку без мест» — тупик, поэтому при наличии такой выбираем её.
 */
export function pickMatchingTrip(
  items: readonly Trip[],
  draft: RouteWindowDraft,
  userId: string | null,
): Trip | null {
  const candidates = items.filter((trip) => isMatchCandidate(trip, draft, userId));
  return candidates.find((trip) => trip.seatsAvailable > 0) ?? candidates[0] ?? null;
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
 * Счётчик — по ОТФИЛЬТРОВАННЫМ кандидатам, а не по `pagination.total`:
 * иначе в текст «уже есть 3 активные поездки» попадали бы свои поездки и
 * поездки с выключенным подбором, на которые заявку сервер не подставит.
 *
 * Сбой сети или ответа — это null, а не исключение: проверка информирующая,
 * и тихо её пропустить дешевле, чем не дать человеку создать заявку.
 */
export async function findMatchingTrip(
  draft: RouteWindowDraft,
  userId: string | null = null,
): Promise<{ trip: Trip; total: number } | null> {
  const filters = buildMatchingTripsQuery(draft);
  if (filters === null) return null;
  const page = await tripsApi.getTrips(filters).catch((error: unknown) => {
    log("[ride-request] предпроверка поездок не удалась", error);
    return null;
  });
  if (page === null) return null;
  const candidates = page.items.filter((trip) =>
    isMatchCandidate(trip, draft, userId),
  );
  const trip = pickMatchingTrip(page.items, draft, userId);
  if (trip === null) return null;
  return { trip, total: candidates.length };
}
