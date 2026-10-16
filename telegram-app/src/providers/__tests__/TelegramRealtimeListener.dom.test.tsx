// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * F1: роль и aria-live realtime-тостов живут на САМОМ Snackbar, а не на
 * обёртке вокруг него.
 *
 * Кит рендерит Snackbar через RootRenderer → createPortal в узел AppRoot,
 * поэтому обёртка с aria-live="polite" вокруг списка нотисов оставалась
 * ПУСТОЙ: текст тоста в неё не попадал, и скринридер не объявлял ничего —
 * при том, что notifyHaptic() отыгрывал. Слепой пользователь не узнавал,
 * что его заявку отклонили или поездку отменили.
 *
 * Рендер в jsdom через AppRoot (а не зондом по рендеру): важно проверить,
 * что роль стоит на узле с ТЕКСТОМ. Утверждение «атрибут есть где-то»
 * было бы верно и для сломанной обёртки — суть бага именно в структуре
 * DOM, поэтому проверяем и структуру (роль на корне тоста, тост — прямой
 * потомок портала), и содержимое (textContent непустой).
 *
 * Без @testing-library/react (не установлен): react-dom/client + act
 * из React 19, сокет — управляемый FakeWebSocket (как в
 * WebSocketProvider.test.tsx), таймеры — fake.
 */

const {
  mockIsRefreshing,
  mockTryRefresh,
  mockSetSession,
  mockInvalidatePendingRefresh,
  mockHaptic,
  mockLoginWithTelegram,
} = vi.hoisted(() => ({
  mockIsRefreshing: vi.fn(),
  mockTryRefresh: vi.fn(),
  mockSetSession: vi.fn(),
  mockInvalidatePendingRefresh: vi.fn(),
  mockHaptic: vi.fn(),
  mockLoginWithTelegram: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  // Модуль мокается целиком, поэтому повторяем и его константы — их читает
  // классификатор закрытия сокета внутри WebSocketProvider.
  ACCOUNT_DELETED_MESSAGE: "Account is deleted",
  ACCOUNT_DELETED_CODE: "ACCOUNT_DELETED",
  isAccountDeletedError: (error: unknown) => {
    if (typeof error !== "object" || error === null) return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    return code === "ACCOUNT_DELETED" || message === "Account is deleted";
  },
  WS_TERMINAL_REASON: {
    deletedByWsAuth: "Account is deleted",
    deletedBySelf: "Account deleted",
    banned: "Account is banned",
  },
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

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: { notificationOccurred: { ifAvailable: mockHaptic } },
  retrieveRawInitData: vi.fn(),
}));

vi.mock("@/api/auth.api", () => ({
  authApi: {
    loginWithTelegram: mockLoginWithTelegram,
    refreshToken: vi.fn(),
  },
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { retrieveRawInitData } from "@tma.js/sdk-react";
import { WsProvider } from "@/providers/WebSocketProvider";
import { TelegramRealtimeListener } from "@/providers/TelegramRealtimeListener";
import { useAuthStore } from "@/store/useAuthStore";

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
}

function lastInstance(): FakeWebSocket {
  const instance = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!instance) throw new Error("no WebSocket instance created");
  return instance;
}

/**
 * Узел AppRoot: у кита он же служит портал-контейнером
 * (`ref: multipleRef(ref, portalContainer)` в AppRoot.js), поэтому
 * createPortal из Snackbar кладёт тост ПРЯМЫМ потомком этого узла —
 * мимо любой обёртки, отрендеренной вглубь дерева.
 */
function portalContainer(): HTMLElement {
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) {
    throw new Error("AppRoot is not mounted");
  }
  return node;
}

/** Живые регионы в любом состоянии: роль ИЛИ aria-live. */
function liveNodes(): HTMLElement[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="status"], [role="alert"], [aria-live]',
    ),
  ];
}

/** Узел, который объявляет текст тоста. */
function roleNode(): HTMLElement {
  const nodes = liveNodes();
  expect(nodes).toHaveLength(1);
  return nodes[0] as HTMLElement;
}

let container: HTMLDivElement;
let root: Root;

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
  mockLoginWithTelegram.mockReset();
  mockLoginWithTelegram.mockResolvedValue(undefined);
  vi.mocked(retrieveRawInitData).mockReturnValue("auth_date=1&hash=dev");
  mockIsRefreshing.mockReturnValue(false);
  mockTryRefresh.mockResolvedValue("success");
  useAuthStore.setState({
    status: "idle",
    user: null,
    session: null,
    banReason: null,
    initData: null,
    lastAuthError: null,
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  for (const ws of FakeWebSocket.instances) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }
  FakeWebSocket.instances = [];
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Сессия в сторе: без неё WsProvider сокет не открывает (и в приложении
 * нечего слушать), поэтому аутентифицируем ДО монтирования listener'а.
 */
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

async function renderListener(): Promise<void> {
  authenticate();

  await act(async () => {
    root.render(
      <AppRoot platform="base">
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
              },
            })
          }
        >
          <WsProvider>
            <TelegramRealtimeListener />
          </WsProvider>
        </QueryClientProvider>
      </AppRoot>,
    );
  });

  const ws = lastInstance();
  await act(async () => {
    ws.serverOpen();
    ws.serverMessage({ type: "auth:ok" });
  });
}

/** Отправляет realtime-событие и дожидается рендера тоста. */
async function emit(payload: Record<string, unknown>): Promise<void> {
  await act(async () => {
    lastInstance().serverMessage(payload);
  });
}

describe("TelegramRealtimeListener: роль на самом Snackbar (F1)", () => {
  it("отклонение заявки: role=alert + aria-live=assertive на узле с текстом", async () => {
    await renderListener();
    await emit({
      type: "booking:status_changed",
      payload: {
        bookingId: "f1-declined",
        tripId: "f1-declined-trip",
        status: "declined",
      },
    });

    const node = roleNode();
    expect(node.getAttribute("role")).toBe("alert");
    expect(node.getAttribute("aria-live")).toBe("assertive");
    // Роль на узле с ТЕКСТОМ, а не на пустом соседе (суть бага).
    expect(node.textContent).toContain("Ваша заявка отклонена");
    expect(node.children.length).toBeGreaterThan(0);
    // Тот же узел — внешний div тоста, прямой потомок портала AppRoot.
    // Если бы роль стояла на обёртке, узел был бы в другом месте дерева.
    expect(node.parentElement).toBe(portalContainer());
  });

  it("отмена поездки водителем: тоже assertive и тоже на тексте", async () => {
    await renderListener();
    await emit({
      type: "trip:status_changed",
      payload: { tripId: "f1-cancelled-trip", status: "cancelled" },
    });

    const node = roleNode();
    expect(node.getAttribute("role")).toBe("alert");
    expect(node.getAttribute("aria-live")).toBe("assertive");
    expect(node.textContent).toContain("Поездка отменена водителем");
    expect(node.children.length).toBeGreaterThan(0);
  });

  it("подтверждение заявки: role=status + aria-live=polite", async () => {
    await renderListener();
    await emit({
      type: "booking:status_changed",
      payload: {
        bookingId: "f1-confirmed",
        tripId: "f1-confirmed-trip",
        status: "confirmed",
      },
    });

    const node = roleNode();
    expect(node.getAttribute("role")).toBe("status");
    expect(node.getAttribute("aria-live")).toBe("polite");
    expect(node.textContent).toContain("Ваша заявка подтверждена!");
  });

  it("изменение деталей поездки: polite, и в узле есть description", async () => {
    await renderListener();
    await emit({
      type: "trip:details_changed",
      payload: { tripId: "f1-details-trip" },
    });

    const node = roleNode();
    expect(node.getAttribute("role")).toBe("status");
    expect(node.getAttribute("aria-live")).toBe("polite");
    // Оба Caption'а (текст и подпись) лежат ВНУТРИ узла роли — то есть
    // скринридер зачитает и заголовок, и пояснение.
    expect(node.textContent).toContain("Детали поездки изменены");
    expect(node.textContent).toContain("проверьте информацию");
  });

  it("негативный контроль: в документе нет пустой live-области", async () => {
    // Именно это ловило баг: обёртка с aria-live="polite" оставалась
    // пустой, потому что текст уезжал в портал мимо неё.
    await renderListener();
    await emit({
      type: "booking:status_changed",
      payload: {
        bookingId: "f1-empty-control",
        tripId: "f1-empty-trip",
        status: "declined",
      },
    });

    const nodes = liveNodes();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.textContent?.trim()).not.toBe("");
    }

    // И никакой второй, параллельной live-области: ровно один анонс.
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(
      document.querySelectorAll('[role="status"], [role="alert"]'),
    ).toHaveLength(1);
    // Узел роли не оборачивает другой живой узел — нет цепочки
    // «обёртка + тост», которая и ломала анонс.
    expect([
      ...roleNode().querySelectorAll(
        '[aria-live], [role="status"], [role="alert"]',
      ),
    ]).toHaveLength(0);
  });

  it("до события в дереве нет ни одного живого узла", async () => {
    await renderListener();
    expect(liveNodes()).toHaveLength(0);
  });
});
