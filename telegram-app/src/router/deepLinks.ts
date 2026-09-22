// telegram-app/src/router/deepLinks.ts
// Канонические Telegram deep-links (см.
// docs/migration/notification-parity-contract.md, раздел «Telegram deep-link format»).
//
// Источники переходов:
// - Bot API startapp-параметр (`?startapp=<token>`) — разбирает
//   resolveStartParamRoute, результат ведёт на внутренний маршрут;
// - tap по инбокс-уведомлению — ведёт notificationRoute из
//   NotificationsPage (единственный источник правды для tap-destinations,
//   покрыт notificationsPage.test.tsx; здесь не дублируется);
// - share поездки — buildTripStartParam/buildTripDeepLink из helpers/tripShare
//   (токен `trip_<uuid>`).
//
// Per-entity ссылки без идентификаторов (заявки на поездку, конкретная бронь,
// авто, репорты, модалка водителя) намеренно не поддерживаются: в startapp
// нельзя класть сырые данные пользователя, а payload уведомления entity-id
// не несёт — та же blocked-причина, что зафиксирована в контракте parity.
// Неизвестный/битый параметр — безопасный fallback на FALLBACK_ROUTE.

export const FALLBACK_ROUTE = "/trips";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRIP_PREFIX = "trip_";

/**
 * UUID поездки из startapp-токена `trip_<uuid>` (голый UUID тоже
 * принимается — совместимость с существующим поведением AppRouter).
 * Мусор и не-UUID отклоняются (null), в запросы ничего не прокидывается.
 */
export function parseTripStartParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.startsWith(TRIP_PREFIX)
    ? value.slice(TRIP_PREFIX.length)
    : value;
  return UUID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Статические section-токены → существующие TG-маршруты AppRouter.
 * Покрывают разделы, утверждённые контрактом (trip, bookings/history,
 * profile/reviews/support), плюс точки входа inbox/settings и «Мои поездки»
 * (раздел назначения booking_created по контракту).
 */
export const START_PARAM_ROUTES: Readonly<Record<string, string>> = {
  trips: "/trips",
  // Алиасы из референса (App.tsx): явный вход в поиск и создание поездки.
  // /trips и есть поиск; создание — шторка /trips/my/new поверх водителя.
  search: "/trips",
  create: "/trips/my/new",
  new: "/trips/my/new",
  bookings: "/bookings",
  history: "/bookings?segment=history",
  my_trips: "/bookings?segment=driver",
  profile: "/profile",
  reviews: "/reviews",
  support: "/profile/support",
  notifications: "/notifications",
  settings: "/settings",
};

/**
 * Полное разрешение startapp-параметра во внутренний маршрут.
 * - `trip_<uuid>` → `/trips/<uuid>`;
 * - известный section-токен → его маршрут из START_PARAM_ROUTES;
 * - пустое/отсутствующее значение → null (навигации нет);
 * - неизвестный/битый токен → FALLBACK_ROUTE (без исключений и утечек данных).
 */
export function resolveStartParamRoute(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const tripId = parseTripStartParam(value);
  if (tripId) return `/trips/${tripId}`;
  const route = START_PARAM_ROUTES[value];
  // typeof-гарда достаточно и против прототипных ключей (`__proto__` —
  // объект, не строка, и уйдёт в fallback).
  if (typeof route === "string" && route.length > 0) return route;
  return FALLBACK_ROUTE;
}
