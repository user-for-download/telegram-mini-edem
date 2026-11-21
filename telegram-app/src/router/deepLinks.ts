// telegram-app/src/router/deepLinks.ts
// Канонические Telegram deep-links (исторический контракт удалён из дерева —
// смотри git: docs/migration/notification-parity-contract.md, раздел
// «Telegram deep-link format»).
//
// Источники переходов:
// - Bot API startapp-параметр (`?startapp=<token>`) — разбирает
//   resolveStartParamRoute, результат ведёт на внутренний маршрут;
// - tap по инбокс-уведомлению — Notification.deepLink (per-entity,
//   серверный allowlist) с fallback на типовую карту notificationRoute
//   в NotificationsPage (единственный источник правды для tap-destinations,
//   покрыт notificationsPage.test.tsx; здесь не дублируется);
// - share поездки — buildTripStartParam/buildTripDeepLink из helpers/tripShare
//   (токен `trip_<uuid>`).
//
// В startapp нельзя класть сырые данные пользователя, поэтому там
// поддерживаются только section-токены и `trip_<uuid>`. Per-entity
// id для инбокса передаётся отдельно — через Notification.deepLink, а не
// через startapp. Неизвестный/битый параметр — безопасный fallback на
// FALLBACK_ROUTE.

import {
  parseTelegramTripStartParam,
  resolveTelegramStartParam,
  TELEGRAM_START_FALLBACK_ROUTE,
  TELEGRAM_START_PARAM_ROUTES,
} from "@edem/contracts";

export const FALLBACK_ROUTE = TELEGRAM_START_FALLBACK_ROUTE;

/**
 * UUID поездки из startapp-токена `trip_<uuid>` (голый UUID тоже
 * принимается — совместимость с существующим поведением AppRouter).
 * Мусор и не-UUID отклоняются (null), в запросы ничего не прокидывается.
 */
export const parseTripStartParam = parseTelegramTripStartParam;

/**
 * Статические section-токены → существующие TG-маршруты AppRouter.
 * Покрывают разделы, утверждённые контрактом (trip, bookings/history,
 * profile/reviews/support), плюс точки входа inbox/settings и «Мои поездки»
 * (раздел назначения booking_created по контракту).
 */
export const START_PARAM_ROUTES = TELEGRAM_START_PARAM_ROUTES;

export function readLaunchStartParam(platformValue: string | undefined, search: string): string | undefined {
  return platformValue || new URLSearchParams(search).get("startapp") || undefined;
}

/**
 * Полное разрешение startapp-параметра во внутренний маршрут.
 * - `trip_<uuid>` → `/trips/<uuid>`;
 * - известный section-токен → его маршрут из START_PARAM_ROUTES;
 * - пустое/отсутствующее значение → null (навигации нет);
 * - неизвестный/битый токен → FALLBACK_ROUTE (без исключений и утечек данных).
 */
export function resolveStartParamRoute(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const route = resolveTelegramStartParam(value);
  if (route !== FALLBACK_ROUTE || Object.hasOwn(START_PARAM_ROUTES, value)) return route;
  // Неизвестный токен: поведение — безопасный fallback (по дизайну), в dev
  // подсвечиваем битую ссылку для диагностики (в проде тихо).
  if (import.meta.env.DEV) {
    console.warn(`[DeepLinks] Unknown startapp token: ${value}`);
  }
  return route;
}
