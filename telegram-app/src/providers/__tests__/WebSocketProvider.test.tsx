// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Интеграция Telegram WS-клиента (tg-migration-14, ws.v1):
 * handshake первым сообщением, ping/pong, reconnect/backoff, терминальный
 * 4403, 1008/4401 через single-flight refresh, resync-инвалидация,
 * дедупликация повторных событий.
 *
 * Без @testing-library/react (не установлен): react-dom/client + act
 * из React 19, сокет — управляемый FakeWebSocket, таймеры — fake.
 */

const {
  mockIsRefreshing,
  mockTryRefresh,
  mockSetSession,
  mockInvalidatePendingRefresh,
  mockHaptic,
} = vi.hoisted(() => ({
  mockIsRefreshing: vi.fn(),
  mockTryRefresh: vi.fn(),
  mockSetSession: vi.fn(),
  mockInvalidatePendingRefresh: vi.fn(),
  mockHaptic: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiClient: {
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    setSession: mockSetSession,
    getToken: vi.fn(),
    onTokenUpdate: vi.fn(() => () => {}),
    onSessionExpired: vi.fn(() => () => {}),
    onBanned: vi.fn(() => () => {}),
    isRefreshing: mockIsRefreshing,
    onRefreshStart: vi.fn(() => () => {}),
    onRefreshEnd: vi.fn(() => () => {}),
    invalidatePendingRefresh: mockInvalidatePendingRefresh,
    request: vi.fn(),
    tryRefresh: mockTryRefresh,
  },
  ApiError: class ApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: { notificationOccurred: { ifAvailable: mockHaptic } },
  retrieveRawInitData: vi.fn(),
}));

vi.mock("@/api/auth.api", () => ({
  authApi: { loginWithTelegram: vi.fn(), refreshToken: vi.fn() },
}));

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  TelegramRealtimeListener,
  WsProvider,
  useWs,
} from "@/providers/WebSocketProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { TRIP_KEYS } from "@/queries/useTripsQuery";
import { BOOKING_KEYS } from "@/queries/useBookingsQuery";

/** Управляемый дубль WebSocket: handshake, события и close — по команде. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverRaw(data: string): void {
    this.onmessage?.({ data });
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

function lastInstance(): FakeWebSocket {
  const instance = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!instance) throw new Error("no WebSocket instance created");
  return instance;
}

function sentMessages(ws: FakeWebSocket): Array<Record<string, unknown>> {
  return ws.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

let probeState = { isConnected: false, resyncSeq: 0, lastType: null as string | null };

function Probe() {
  const value = useWs();
  // Запись в module-state — только из эффекта (react-hooks/globals
  // запрещает запись глобалов фазой рендера). Тесты читают probeState
  // после await act(...), эффекты к тому моменту сброшены.
  useEffect(() => {
    probeState = {
      isConnected: value.isConnected,
      resyncSeq: value.resyncSeq,
      lastType: value.lastMessage?.type ?? null,
    };
  });
  return null;
}

function authenticate(accessToken = "access-1"): void {
  useAuthStore.setState({
    status: "authenticated",
    session: {
      accessToken,
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 900_000,
    },
  });
}

describe("WsProvider: handshake и ping/pong (ws.v1)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    document.body.innerHTML = "";
    mockIsRefreshing.mockReset();
    mockTryRefresh.mockReset();
    mockSetSession.mockReset();
    mockInvalidatePendingRefresh.mockReset();
    mockHaptic.mockReset();
    mockIsRefreshing.mockReturnValue(false);
    mockTryRefresh.mockResolvedValue("success");
    probeState = { isConnected: false, resyncSeq: 0, lastType: null };
    useAuthStore.setState({
      status: "idle",
      user: null,
      session: null,
      banReason: null,
      initData: null,
      lastAuthError: null,
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    // Живой сокет переживает unmount при активной сессии (нет лишнего
    // reconnect-шторма) — гасим хендлеры, чтобы не текли между тестами.
    for (const ws of FakeWebSocket.instances) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    }
    FakeWebSocket.instances = [];
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderProvider(): Promise<void> {
    await act(async () => {
      root?.render(
        <AppRoot platform="base">
          <QueryClientProvider client={queryClient}>
            <WsProvider>
              <Probe />
              <TelegramRealtimeListener />
            </WsProvider>
          </QueryClientProvider>
        </AppRoot>,
      );
    });
  }

  function invalidateCallsFor(key: ReadonlyArray<string | object>): number {
    return invalidateSpy.mock.calls.filter(
      (call: unknown[]) =>
        JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
        JSON.stringify(key),
    ).length;
  }

  it("без сессии сокет не открывается", async () => {
    await renderProvider();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("auth — первое сообщение с JWT; в URL нет кредов", async () => {
    authenticate();
    await renderProvider();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = lastInstance();
    expect(ws.url).not.toContain("?");
    expect(ws.url).not.toContain("token");
    expect(ws.url).not.toContain("initData");
    expect(ws.url.endsWith("/api/v1/ws")).toBe(true);

    await act(async () => {
      ws.serverOpen();
    });

    const sent = sentMessages(ws);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "auth", token: "access-1" });
    expect(ws.sent.join("")).not.toContain("initData");
    expect(ws.sent.join("")).not.toContain("dev-hash");
  });

  it("auth:ok поднимает флаг; ping → pong; мусор игнорируется", async () => {
    authenticate();
    await renderProvider();
    const ws = lastInstance();

    await act(async () => {
      ws.serverOpen();
      ws.serverMessage({ type: "auth:ok" });
    });
    expect(probeState.isConnected).toBe(true);

    await act(async () => {
      ws.serverMessage({ type: "ping" });
    });
    expect(sentMessages(ws)).toContainEqual({ type: "pong" });

    await act(async () => {
      ws.serverRaw("{{not-json");
      ws.serverMessage({ type: "unknown-future", payload: {} });
      ws.serverMessage({ type: "booking:new" });
    });
    expect(probeState.lastType).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("booking:new инвалидирует trips/bookings и показывает одно уведомление", async () => {
    authenticate();
    await renderProvider();
    const ws = lastInstance();
    await act(async () => {
      ws.serverOpen();
      ws.serverMessage({ type: "auth:ok" });
    });

    await act(async () => {
      ws.serverMessage({
        type: "booking:new",
        payload: { bookingId: "b-1", tripId: "t-1" },
      });
    });

    expect(invalidateCallsFor([...TRIP_KEYS.my()])).toBe(1);
    expect(invalidateCallsFor([...BOOKING_KEYS.trip("t-1")])).toBe(1);
    expect(invalidateCallsFor([...TRIP_KEYS.detail("t-1")])).toBe(1);
    expect(document.body.textContent).toContain("Новая заявка на поездку");
  });

  it("повтор того же события — дубликат: без повторной инвалидации и нотиса", async () => {
    authenticate();
    await renderProvider();
    const ws = lastInstance();
    await act(async () => {
      ws.serverOpen();
      ws.serverMessage({ type: "auth:ok" });
    });

    const event = {
      type: "booking:status_changed",
      payload: { bookingId: "b-9", tripId: "t-9", status: "confirmed" },
    };
    await act(async () => {
      ws.serverMessage(event);
    });
    await act(async () => {
      ws.serverMessage(event);
    });

    expect(invalidateCallsFor([...BOOKING_KEYS.my()])).toBe(1);
    const matches =
      document.body.textContent?.match(/Ваша заявка подтверждена!/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(mockHaptic).toHaveBeenCalledTimes(1);
  });

  it("обрыв 1001 → reconnect с backoff; после auth:ok — resync trips+bookings", async () => {
    authenticate();
    await renderProvider();
    const first = lastInstance();
    await act(async () => {
      first.serverOpen();
      first.serverMessage({ type: "auth:ok" });
    });
    invalidateSpy.mockClear();

    await act(async () => {
      first.serverClose(1001, "going away");
    });
    expect(probeState.isConnected).toBe(false);
    // Backoff ещё не истёк — второго сокета нет.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = lastInstance();

    await act(async () => {
      second.serverOpen();
      second.serverMessage({ type: "auth:ok" });
    });
    expect(probeState.resyncSeq).toBe(1);
    expect(invalidateCallsFor([...TRIP_KEYS.all])).toBe(1);
    expect(invalidateCallsFor([...BOOKING_KEYS.all])).toBe(1);
    // Reconnect несёт свежий auth с тем же токеном.
    expect(sentMessages(second)[0]).toEqual({ type: "auth", token: "access-1" });
  });

  it("4403 — терминально: бан-экран, ни reconnect, ни refresh-loop", async () => {
    authenticate();
    await renderProvider();
    const ws = lastInstance();
    await act(async () => {
      ws.serverOpen();
      ws.serverMessage({ type: "auth:ok" });
    });

    await act(async () => {
      ws.serverClose(4403, "Account is banned");
      await flushMicrotasks();
    });

    const state = useAuthStore.getState();
    expect(state.status).toBe("banned");
    expect(state.session).toBeNull();
    expect(mockTryRefresh).not.toHaveBeenCalled();
    expect(mockSetSession).toHaveBeenCalledWith(null);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("1008 → single-flight refresh, reconnect с новым токеном", async () => {
    authenticate("access-1");
    await renderProvider();
    const first = lastInstance();
    await act(async () => {
      first.serverOpen();
      first.serverMessage({ type: "auth:ok" });
    });

    mockTryRefresh.mockImplementation(async () => {
      authenticate("access-2");
      return "success";
    });

    await act(async () => {
      first.serverClose(1008, "Invalid token");
      await flushMicrotasks();
    });

    expect(mockTryRefresh).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = lastInstance();
    // onopen шлёт auth синхронно — кадр проверяем сразу после открытия.
    await act(async () => {
      second.serverOpen();
    });
    expect(sentMessages(second)[0]).toEqual({ type: "auth", token: "access-2" });
  });

  it("перманентный отказ refresh — стоп без reconnect (сессией владеет AuthGate)", async () => {
    authenticate();
    await renderProvider();
    const ws = lastInstance();
    await act(async () => {
      ws.serverOpen();
      ws.serverMessage({ type: "auth:ok" });
    });

    mockTryRefresh.mockResolvedValue("permanent-rejection");
    await act(async () => {
      ws.serverClose(4401, "Invalid token");
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
