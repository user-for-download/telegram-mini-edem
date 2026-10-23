import type { WsServerEvent } from "@edem/contracts";

/**
 * Telegram WebSocket transport helpers (ws.v1).
 *
 * Чистые функции без React/DOM — покрыты unit-тестами
 * (`src/api/__tests__/ws.test.ts`).
 * Схемы событий — `wsServerEventSchema` / `wsClientMessageSchema` из
 * `@edem/contracts`; здесь берётся только ВИД типа события (type-only импорт),
 * чтобы таблица политики дедупликации проверялась компилятором.
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
 *
 * Сброс целиком остаётся осознанным компромиссом: он fail-open (повторный
 * эффект) и обратен пропуску эффекта. Плата за него растёт вместе с
 * `repeatable`-событиями (см. WS_EVENT_DEDUP_POLICY): каждая правка поездки
 * занимает отдельный ключ из-за временного окна и вытесняет историю строгих
 * событий быстрее. Это приемлемо, потому что «забытый» ключ стоит максимум
 * одной повторной (идемпотентной) инвалидации, а проглоченная правка стоит
 * устаревших цены/адреса у пассажира.
 */
export const WS_SEEN_EVENTS_MAX = 200;

/**
 * Типы бизнес-событий ws.v1. Служебные `auth:ok`/`ping` исключены: у них
 * нет payload и дедупликации они не подлежат (их разбирает сам провайдер).
 * Тип выведен из контракта — новый тип в схеме нельзя забыть внести в
 * таблицу политики, компилятор потребует строку.
 */
export type WsBusinessEventType = Exclude<
  WsServerEvent["type"],
  "auth:ok" | "ping"
>;

/**
 * Политика дедупликации по типу события.
 *
 * - `strict` — тот же payload физически означает то же самое событие:
 *   в payload лежит идентификатор сущности ИЛИ её новое состояние
 *   (`bookingId`, `status`), поэтому повтор — это либо повторная доставка
 *   после reconnect/resync, либо дубль кадра. Эффект глушим.
 * - `repeatable` — сигнал «состояние изменилось», у которого НЕТ версии в
 *   payload: `trip:details_changed` приходит при каждом `PATCH /trips/:id`
 *   с одним и тем же `{tripId}`, и вторая правка в сессии неотличима от
 *   первой по ключу (F5). Строгий ключ проглатывал бы все правки, кроме
 *   первой, поэтому в ключ добавляется временное окно.
 */
export type WsEventDedupPolicy = "strict" | "repeatable";

/**
 * Ширина окна для `repeatable`-событий. Два одинаковых payload'а внутри
 * окна — одна правка (повтор доставки после reconnect приходит в пределах
 * миллисекунд, а не секунд), за окном — разные правки. Окно намеренно
 * много больше времени между двумя правками одного человека (PATCH →
 * форма → PATCH) и много меньше времени жизни приложения.
 */
export const WS_REPEATABLE_EVENT_WINDOW_MS = 2_000;

/**
 * Политика дедупликации по типам событий контракта ws.v1.
 *
 * Явная таблица, а не вывод из формы ключа: «повторяемость» — свойство
 * типа события, а не формата payload. Классификация по каждому типу:
 *
 * | тип                       | policy      | почему |
 * |---------------------------|-------------|--------|
 * | `booking:new`             | `strict`    | `bookingId` один на бронь — второй раз это событие прийти не может |
 * | `booking:status_changed`  | `strict`    | в payload `status`: повтор = тот же переход того же брони |
 * | `trip:status_changed`     | `strict`    | в payload `status`: повтор = тот же переход той же поездки |
 * | `trip:details_changed`    | `repeatable`| payload = только `{tripId}`: любая правка деталей (время/адрес/цена) выглядит одинаково |
 * | `notification:new`        | `repeatable`| sentinel-хинт `NOTIFICATION_HINT_REFRESH_ID`: payload одинаков всегда, смысла в нём нет |
 * | `visibility:changed`      | `strict`    | уникальный eventId на block/unblock |
 *
 * Типы вне таблицы (в т.ч. добавленные в контракт позже) дедуплицируются
 * строго — дефолт fail-closed: лучше лишняя (идемпотентная) инвалидация,
 * чем проглоченное событие.
 */
export const WS_EVENT_DEDUP_POLICY: Readonly<
  Record<WsBusinessEventType, WsEventDedupPolicy>
> = {
  "booking:new": "strict",
  "booking:status_changed": "strict",
  "trip:status_changed": "strict",
  "trip:details_changed": "repeatable",
  "notification:new": "repeatable",
  "visibility:changed": "strict",
};

/**
 * Политика дедупликации для типа события. Неизвестный тип → `strict`
 * (см. комментарий к таблице).
 */
export function wsEventDedupPolicy(type: string): WsEventDedupPolicy {
  const policy: WsEventDedupPolicy | undefined =
    WS_EVENT_DEDUP_POLICY[type as WsBusinessEventType];
  return policy ?? "strict";
}

/**
 * Стабильный ключ события для дедупликации: тип + пейлоад.
 * Пейлоады плоские ({bookingId, tripId, ...}), JSON.stringify детерминирован.
 *
 * Для `repeatable`-типов (см. WS_EVENT_DEDUP_POLICY) к ключу добавляется
 * номер временного окна: версии в payload нет, и без окна вторая правка
 * той же поездки не отличилась бы от первой. `now` инжектится ради
 * детерминированных тестов (по умолчанию `Date.now`) — функция остаётся
 * чистой: изменение времени не меняет прошлое вычисление.
 */
export function buildWsEventKey(
  type: string,
  payload: unknown,
  now: number = Date.now(),
): string {
  const key = `${type}:${JSON.stringify(payload ?? null)}`;
  if (wsEventDedupPolicy(type) !== "repeatable") return key;
  return `${key}@${Math.floor(now / WS_REPEATABLE_EVENT_WINDOW_MS)}`;
}

export interface MarkSeenResult {
  seen: Set<string>;
  /** True = событие уже видели (дубликат), эффект нужно пропустить. */
  duplicate: boolean;
}

/**
 * Отмечает событие как обработанное. Чистая функция: входное множество
 * не мутируется. Возвращает новое множество + флаг дубликата.
 *
 * Ключ приходит уже готовым (`buildWsEventKey`) — именно там живёт
 * политика по типу события, здесь только само множество.
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
