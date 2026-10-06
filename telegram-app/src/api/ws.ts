/**
 * Telegram WebSocket transport helpers (ws.v1).
 *
 * Чистые функции без React/DOM — покрыты unit-тестами
 * (`src/api/__tests__/ws.test.ts`).
 * Схемы событий — `wsServerEventSchema` / `wsClientMessageSchema` из
 * `@edem/contracts`.
 * Этот модуль НЕ дублирует схемы, только транспортную политику клиента.
 */

/** Базовая задержка reconnect: 1s, удвоение на попытку. */
export const WS_RECONNECT_BASE_DELAY_MS = 1_000;
/** Потолок задержки reconnect: 30s. */
export const WS_RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Bounded exponential backoff с джиттером `0.75..1.25` (контракт ws.v1).
 * `attempt` — 0 для первой повторной попытки. `random` инжектится ради
 * детерминированных тестов (по умолчанию `Math.random`).
 */
export function computeReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const baseDelay = Math.min(
    WS_RECONNECT_BASE_DELAY_MS * 2 ** safeAttempt,
    WS_RECONNECT_MAX_DELAY_MS,
  );
  return Math.round(baseDelay * (0.75 + random() * 0.5));
}

export type WsClosePolicy =
  | "auth-refresh"
  | "terminal"
  | "stop"
  | "reconnect";

/**
 * Политика клиента по коду закрытия (таблица «Close codes» контракта ws.v1).
 *
 * - `terminal` (4403 — бан/удаление): остановить автоматический reconnect,
 *   сессию — по HTTP auth-политике, показать account-state экран.
 *   Refresh-loop запрещён.
 * - `auth-refresh` (1008/4401): прогнать существующий single-flight HTTP
 *   refresh; успех — reconnect с новым токеном, перманентный отказ — стоп.
 * - `stop` (1000 — normal): сокет закрыт штатно, reconnect только при
 *   перезапуске жизненного цикла приложения.
 * - `reconnect` (всё остальное: 1001 pong-timeout/shutdown, 1003 данные,
 *   1011 внутренняя ошибка, 1013 throttle, неизвестные): bounded backoff.
 */
export function classifyWsClose(code: number): WsClosePolicy {
  if (code === 4403) return "terminal";
  if (code === 1008 || code === 4401) return "auth-refresh";
  if (code === 1000) return "stop";
  return "reconnect";
}

/**
 * Выводит WS URL из настроенного API origin. Токен и initData НИКОГДА не
 * попадают в URL (query-параметры светятся в логах прокси/браузера):
 * JWT передаётся первым сообщением `{"type":"auth","token":...}`.
 *
 * - `https://api.example.com/api/v1` → `wss://api.example.com/api/v1/ws`
 * - `http://127.0.0.1:3011/api/v1` → `ws://127.0.0.1:3011/api/v1/ws`
 * - относительный `/api/v1` → хост текущей страницы, схема по протоколу.
 */
export function getWsUrl(
  apiBaseUrl: string = import.meta.env.VITE_API_URL || "/api/v1",
  loc?: { protocol: string; host: string },
): string {
  if (apiBaseUrl.startsWith("http")) {
    return apiBaseUrl.replace(/^http/, "ws") + "/ws";
  }
  const location = loc ?? globalThis.location;
  if (!location) {
    throw new Error("getWsUrl: relative API base requires a page location");
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${apiBaseUrl}/ws`;
}

/**
 * Верхняя граница множества уже обработанных WS-событий. После reconnect
 * клиент делает resync (инвалидация + refetch), а сервер может повторно доставить события, пропущенные во время
 * обрыва. При переполнении множество очищается целиком — лучше один
 * возможный повтор, чем бесконечный рост памяти.
 */
export const WS_SEEN_EVENTS_MAX = 200;

/**
 * Стабильный ключ события для дедупликации: тип + пейлоад.
 * Пейлоады плоские ({bookingId, tripId, ...}), JSON.stringify детерминирован.
 */
export function buildWsEventKey(type: string, payload: unknown): string {
  return `${type}:${JSON.stringify(payload ?? null)}`;
}

export interface MarkSeenResult {
  seen: Set<string>;
  /** True = событие уже видели (дубликат), эффект нужно пропустить. */
  duplicate: boolean;
}

/**
 * Отмечает событие как обработанное. Чистая функция: входное множество
 * не мутируется. Возвращает новое множество + флаг дубликата.
 */
export function markSeenEvent(
  seen: ReadonlySet<string>,
  key: string,
): MarkSeenResult {
  if (seen.has(key)) {
    return { seen: new Set(seen), duplicate: true };
  }
  if (seen.size >= WS_SEEN_EVENTS_MAX) {
    return { seen: new Set([key]), duplicate: false };
  }
  return { seen: new Set(seen).add(key), duplicate: false };
}
