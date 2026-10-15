import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { wsServerEventSchema } from "@edem/contracts";
import {
  WS_EVENT_DEDUP_POLICY,
  WS_RECONNECT_BASE_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
  WS_REPEATABLE_EVENT_WINDOW_MS,
  WS_SEEN_EVENTS_MAX,
  buildWsEventKey,
  classifyWsClose,
  computeReconnectDelay,
  getWsUrl,
  markSeenEvent,
  wsEventDedupPolicy,
} from "@/api/ws";

/**
 * Транспортная политика Telegram WS-клиента (tg-migration-14, ws.v1):
 * handshake без кредов в URL, bounded backoff 1s→30s + jitter,
 * close-code политика, дедупликация эффектов.
 */
describe("getWsUrl: токен/initData никогда не попадают в URL", () => {
  it("https API origin → wss URL с /ws", () => {
    expect(getWsUrl("https://api.example.com/api/v1")).toBe(
      "wss://api.example.com/api/v1/ws",
    );
  });

  it("http API origin → ws URL (dev-стенд)", () => {
    expect(getWsUrl("http://127.0.0.1:3011/api/v1")).toBe(
      "ws://127.0.0.1:3011/api/v1/ws",
    );
  });

  it("относительный base → хост страницы, схема по протоколу", () => {
    expect(
      getWsUrl("/api/v1", { protocol: "https:", host: "tg.example.com" }),
    ).toBe("wss://tg.example.com/api/v1/ws");
    expect(
      getWsUrl("/api/v1", { protocol: "http:", host: "localhost:3012" }),
    ).toBe("ws://localhost:3012/api/v1/ws");
  });

  it("в URL нет ни токена, ни initData, ни query-параметров вообще", () => {
    for (const url of [
      getWsUrl("https://api.example.com/api/v1"),
      getWsUrl("/api/v1", { protocol: "https:", host: "tg.example.com" }),
    ]) {
      expect(url).not.toContain("?");
      expect(url).not.toContain("token");
      expect(url).not.toContain("initData");
      expect(url).not.toContain("auth_date");
      expect(url).not.toContain("hash");
    }
  });
});

describe("computeReconnectDelay: bounded exponential backoff + jitter", () => {
  it("база 1s на первой попытке, удвоение дальше (без джиттера)", () => {
    const noJitter = () => 0.5; // 0.75 + 0.5*0.5 = 1.0
    expect(computeReconnectDelay(0, noJitter)).toBe(1000);
    expect(computeReconnectDelay(1, noJitter)).toBe(2000);
    expect(computeReconnectDelay(2, noJitter)).toBe(4000);
  });

  it("потолок 30s держится на больших попытках", () => {
    const noJitter = () => 0.5;
    expect(computeReconnectDelay(10, noJitter)).toBe(WS_RECONNECT_MAX_DELAY_MS);
    expect(computeReconnectDelay(100, noJitter)).toBe(WS_RECONNECT_MAX_DELAY_MS);
    expect(WS_RECONNECT_BASE_DELAY_MS).toBe(1000);
    expect(WS_RECONNECT_MAX_DELAY_MS).toBe(30000);
  });

  it("джиттер в диапазоне 0.75..1.25 от базы", () => {
    expect(computeReconnectDelay(1, () => 0)).toBe(1500); // 2000 * 0.75
    expect(computeReconnectDelay(1, () => 1)).toBe(2500); // 2000 * 1.25
  });

  it("отрицательные/дробные попытки нормализуются", () => {
    const noJitter = () => 0.5;
    expect(computeReconnectDelay(-3, noJitter)).toBe(1000);
    expect(computeReconnectDelay(1.9, noJitter)).toBe(2000);
  });
});

describe("classifyWsClose: политика по кодам закрытия (контракт ws.v1)", () => {
  it("4403 — терминальный бан/удаление (без reconnect-loop)", () => {
    expect(classifyWsClose(4403)).toBe("terminal");
  });

  it("1008/4401 — auth-refresh через single-flight HTTP refresh", () => {
    expect(classifyWsClose(1008)).toBe("auth-refresh");
    expect(classifyWsClose(4401)).toBe("auth-refresh");
  });

  it("1000 — штатная остановка, reconnect только по жизненному циклу", () => {
    expect(classifyWsClose(1000)).toBe("stop");
  });

  it("транзиентные коды — reconnect с backoff", () => {
    for (const code of [1001, 1003, 1011, 1013, 1006, 4000]) {
      expect(classifyWsClose(code)).toBe("reconnect");
    }
  });
});

describe("дедупликация эффектов WS-событий", () => {
  it("ключ стабилен для одинаковых type+payload", () => {
    expect(
      buildWsEventKey("booking:new", { bookingId: "b-1", tripId: "t-1" }),
    ).toBe(buildWsEventKey("booking:new", { bookingId: "b-1", tripId: "t-1" }));
    expect(
      buildWsEventKey("booking:new", { bookingId: "b-1", tripId: "t-1" }),
    ).not.toBe(
      buildWsEventKey("booking:new", { bookingId: "b-2", tripId: "t-1" }),
    );
  });

  it("повтор помечается дубликатом, входное множество не мутируется", () => {
    const first = markSeenEvent(new Set(), "booking:new:{\"a\":1}");
    expect(first.duplicate).toBe(false);
    expect(first.seen.size).toBe(1);

    const second = markSeenEvent(first.seen, "booking:new:{\"a\":1}");
    expect(second.duplicate).toBe(true);
    expect(first.seen.size).toBe(1);
  });

  it("переполнение сбрасывает множество (без бесконечного роста памяти)", () => {
    let seen = new Set<string>();
    for (let i = 0; i < WS_SEEN_EVENTS_MAX; i++) {
      seen = markSeenEvent(seen, `event:${i}`).seen;
    }
    expect(seen.size).toBe(WS_SEEN_EVENTS_MAX);
    const overflow = markSeenEvent(seen, "event:overflow");
    expect(overflow.duplicate).toBe(false);
    expect(overflow.seen).toEqual(new Set(["event:overflow"]));
  });
});

/**
 * F5: дедупликация по типу события, а не по форме ключа.
 *
 * `trip:details_changed` приходит при каждом `PATCH /trips/:id` с ОДНИМ И ТЕМ
 * ЖЕ payload `{tripId}` (backend/src/trips/index.ts). Ключ `type+payload`
 * делал вторую правку в сессии неотличимой от первой, и она молча
 * проглатывалась: пассажир оставался с устаревшими ценой/адресом/временем
 * (`staleTime: 60_000`, `refetchOnWindowFocus: false`).
 */
describe("политика дедупликации по типу события (F5)", () => {
  /** Ровно по границе окна: T0 кратен WS_REPEATABLE_EVENT_WINDOW_MS. */
  const T0 = 1_700_000_000_000;
  const window = WS_REPEATABLE_EVENT_WINDOW_MS;

  it("таблица политики совпадает с классификацией событий контракта", () => {
    expect(WS_EVENT_DEDUP_POLICY).toEqual({
      // Уникальны по природе: в payload идентификатор сущности или её
      // новое состояние.
      "booking:new": "strict",
      "booking:status_changed": "strict",
      "trip:status_changed": "strict",
      // Повторяемы: payload `{tripId}` одинаков при любой правке.
      "trip:details_changed": "repeatable",
      // Sentinel-хинт «перезабери inbox» — payload всегда одинаков.
      "notification:new": "repeatable",
    });
  });

  it("каждый подписанный useWsEvent тип имеет строку политики", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../providers/TelegramRealtimeListener.tsx",
      ),
      "utf8",
    );
    const subscribed = [
      ...source.matchAll(/useWsEvent\(\s*["']([^"']+)["']/g),
    ].map((match) => match[1] as string);

    // Скан не должен молча разойтись с исходником (смена кавычек/формата).
    expect(subscribed).toEqual(
      expect.arrayContaining([
        "booking:new",
        "booking:status_changed",
        "trip:status_changed",
        "trip:details_changed",
        "notification:new",
      ]),
    );
    for (const type of subscribed) {
      // Object.hasOwn, а не прямая индексация: прототипные ключи Set/Object
      // не должны «найти» политику (MEMORY.md §18).
      expect(Object.hasOwn(WS_EVENT_DEDUP_POLICY, type)).toBe(true);
    }
  });

  it("trip:details_changed: вторая правка за окно — НЕ дубликат (F5)", () => {
    const firstKey = buildWsEventKey("trip:details_changed", { tripId: "t-1" }, T0);
    const secondKey = buildWsEventKey(
      "trip:details_changed",
      { tripId: "t-1" },
      T0 + window,
    );
    // Ключи различаются — иначе вторая правка неотличима от первой.
    expect(secondKey).not.toBe(firstKey);

    const first = markSeenEvent(new Set(), firstKey);
    expect(first.duplicate).toBe(false);
    const second = markSeenEvent(first.seen, secondKey);
    expect(second.duplicate).toBe(false);
    expect(second.seen.size).toBe(2);

    // N правок подряд за окнами — N эффектов (первая + три следующих).
    let seen = first.seen;
    for (let i = 1; i <= 3; i++) {
      const step = markSeenEvent(
        seen,
        buildWsEventKey("trip:details_changed", { tripId: "t-1" }, T0 + i * window),
      );
      expect(step.duplicate).toBe(false);
      seen = step.seen;
    }
    expect(seen.size).toBe(4);
  });

  it("trip:details_changed: повтор доставки ВНУТРИ окна — дубликат", () => {
    const key = buildWsEventKey("trip:details_changed", { tripId: "t-1" }, T0);
    const resent = buildWsEventKey(
      "trip:details_changed",
      { tripId: "t-1" },
      T0 + window - 1,
    );
    expect(resent).toBe(key);

    const first = markSeenEvent(new Set(), key);
    expect(first.duplicate).toBe(false);
    expect(markSeenEvent(first.seen, resent).duplicate).toBe(true);
  });

  it("booking:new: тот же payload дважды — всегда дубликат (в любом времени)", () => {
    const first = buildWsEventKey(
      "booking:new",
      { bookingId: "b-1", tripId: "t-1" },
      T0,
    );
    const second = buildWsEventKey(
      "booking:new",
      { bookingId: "b-1", tripId: "t-1" },
      T0 + 10 * window,
    );
    expect(second).toBe(first);

    const seen = markSeenEvent(new Set(), first);
    expect(seen.duplicate).toBe(false);
    expect(markSeenEvent(seen.seen, second).duplicate).toBe(true);
  });

  it("*_status_changed: тот же booking/trip + status — всегда дубликат", () => {
    const cases = [
      {
        type: "booking:status_changed",
        payload: { bookingId: "b-1", tripId: "t-1", status: "confirmed" },
      },
      { type: "trip:status_changed", payload: { tripId: "t-1", status: "cancelled" } },
    ] as const;

    for (const { type, payload } of cases) {
      expect(wsEventDedupPolicy(type)).toBe("strict");
      const first = markSeenEvent(
        new Set(),
        buildWsEventKey(type, payload, T0),
      );
      expect(first.duplicate).toBe(false);
      // Даже спустя 10 окон повтор того же перехода — дубль.
      const second = markSeenEvent(
        first.seen,
        buildWsEventKey(type, payload, T0 + 10 * window),
      );
      expect(second.duplicate).toBe(true);
      // Смена status — другой переход, дубликатом не считается.
      const next = markSeenEvent(
        first.seen,
        buildWsEventKey(
          type,
          { ...payload, status: payload.status === "confirmed" ? "declined" : "completed" },
          T0,
        ),
      );
      expect(next.duplicate).toBe(false);
    }
  });

  it("неизвестный тип события дедуплицируется строго (fail-closed)", () => {
    expect(wsEventDedupPolicy("booking:unknown_future")).toBe("strict");
    const key = buildWsEventKey("booking:unknown_future", { x: 1 }, T0);
    const other = buildWsEventKey("booking:unknown_future", { x: 1 }, T0 + 10 * window);
    expect(other).toBe(key);
  });

  it("потолок WS_SEEN_EVENTS_MAX держится и на repeatable-ключах, вход не мутируется", () => {
    let seen: ReadonlySet<string> = new Set();
    const before = new Set(seen);
    for (let i = 0; i < WS_SEEN_EVENTS_MAX * 2; i++) {
      const step = markSeenEvent(
        seen,
        buildWsEventKey(
          "trip:details_changed",
          { tripId: "t-1" },
          T0 + i * window,
        ),
      );
      expect(step.duplicate).toBe(false);
      seen = step.seen;
      expect(seen.size).toBeLessThanOrEqual(WS_SEEN_EVENTS_MAX);
    }
    // Чистота markSeenEvent: предыдущее множество не тронуто.
    expect(before.size).toBe(0);
  });
});

describe("ws.v1 wire-контракт: парсер принимает все события, отвергает мусор", () => {
  it("auth:ok и ping без payload", () => {
    expect(wsServerEventSchema.safeParse({ type: "auth:ok" }).success).toBe(true);
    expect(wsServerEventSchema.safeParse({ type: "ping" }).success).toBe(true);
  });

  it("все бизнес-события контракта", () => {
    const events = [
      { type: "booking:new", payload: { bookingId: "b-1", tripId: "t-1" } },
      {
        type: "booking:status_changed",
        payload: { bookingId: "b-1", tripId: "t-1", status: "confirmed" },
      },
      { type: "trip:status_changed", payload: { tripId: "t-1", status: "cancelled" } },
      { type: "trip:details_changed", payload: { tripId: "t-1" } },
      { type: "notification:new", payload: { id: "n-1" } },
    ];
    for (const event of events) {
      expect(wsServerEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("неизвестный тип и кривой payload — reject (клиент игнорирует)", () => {
    expect(wsServerEventSchema.safeParse({ type: "error", message: "x" }).success).toBe(false);
    expect(wsServerEventSchema.safeParse({ type: "booking:new" }).success).toBe(false);
    expect(
      wsServerEventSchema.safeParse({
        type: "booking:new",
        payload: { bookingId: "b-1" },
      }).success,
    ).toBe(false);
    expect(wsServerEventSchema.safeParse(null).success).toBe(false);
    expect(wsServerEventSchema.safeParse("ping").success).toBe(false);
  });
});
