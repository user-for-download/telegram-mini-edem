/** Shared launch-route protocol for Telegram links and direct web_app URLs. */
export const TELEGRAM_START_PARAM_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  trips: "/trips", search: "/trips", create: "/trips/my/new", new: "/trips/my/new",
  bookings: "/bookings", history: "/profile/history", my_trips: "/bookings?segment=driving",
  profile: "/profile", reviews: "/reviews", support: "/profile/support",
  notifications: "/notifications", settings: "/settings", vehicle: "/vehicle",
  reports: "/profile/reports", ride_requests: "/profile/ride-requests",
});

export const TELEGRAM_START_FALLBACK_ROUTE = "/trips";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTelegramTripStartParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.startsWith("trip_") ? value.slice(5) : value;
  return UUID.test(candidate) ? candidate : null;
}

export function resolveTelegramStartParam(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const tripId = parseTelegramTripStartParam(value);
  if (tripId) return `/trips/${tripId}`;
  if (value.startsWith("requests_") && UUID.test(value.slice(9))) {
    return `/trips/my/${value.slice(9)}/requests`;
  }
  return Object.hasOwn(TELEGRAM_START_PARAM_ROUTES, value)
    ? TELEGRAM_START_PARAM_ROUTES[value]!
    : TELEGRAM_START_FALLBACK_ROUTE;
}

export function buildTelegramStartParam(route: string): string {
  const trip = /^\/trips\/([^/]+)$/.exec(route);
  if (trip && UUID.test(trip[1]!)) return `trip_${trip[1]}`;
  const requests = /^\/trips\/my\/([^/]+)\/requests$/.exec(route);
  if (requests && UUID.test(requests[1]!)) return `requests_${requests[1]}`;
  const canonical = route === "/trips/my" ? TELEGRAM_START_PARAM_ROUTES.my_trips
    : route === "/bookings/history" ? TELEGRAM_START_PARAM_ROUTES.history : route;
  return Object.entries(TELEGRAM_START_PARAM_ROUTES).find(([, path]) => path === canonical)?.[0] ?? "notifications";
}
