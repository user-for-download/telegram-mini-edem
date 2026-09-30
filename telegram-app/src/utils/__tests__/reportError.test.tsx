// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render } from "@testing-library/react";
import { ApiError } from "@/api/client.ts";
import { ErrorBoundary } from "@/components/ErrorBoundary.tsx";
import {
  initErrorReporting,
  isNoiseError,
  reportError,
} from "@/utils/reportError.ts";

// Флаг тестового окружения React 19 для act() (паттерн AppConfig.test.tsx).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const sendBeacon = vi.fn();
const fetchMock = vi.fn();

function lastBeaconPayload(): Record<string, unknown> {
  const raw = sendBeacon.mock.calls.at(-1)?.[1];
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string);
}

beforeEach(() => {
  // Прод-режим: репортёр реально отправляет (в dev — только log).
  vi.stubEnv("DEV", false);
  Object.defineProperty(window.navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(undefined);
  sendBeacon.mockReturnValue(true);
  sendBeacon.mockClear();
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isNoiseError — фильтр шума", () => {
  it("режет ResizeObserver, Script error, расширения, AbortError", () => {
    expect(
      isNoiseError(new Error("ResizeObserver loop completed with undelivered notifications.")),
    ).toBe(true);
    expect(isNoiseError(new Error("Script error."))).toBe(true);
    const ext = new Error("boom");
    ext.stack = "at foo (chrome-extension://abc/content.js:1:2)";
    expect(isNoiseError(ext)).toBe(true);
    const abort = new DOMException("aborted", "AbortError");
    expect(isNoiseError(abort)).toBe(true);
  });

  it("режет сетевой шум нестабильных сетей", () => {
    expect(isNoiseError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNoiseError(new TypeError("Load failed"))).toBe(true);
    expect(
      isNoiseError(new Error("NetworkError when attempting to fetch resource.")),
    ).toBe(true);
    expect(isNoiseError(new Error("Network request failed"))).toBe(true);
  });

  it("пропускает протухший чанк после деплоя (React.lazy)", () => {
    expect(
      isNoiseError(
        new TypeError("Failed to fetch dynamically imported module"),
      ),
    ).toBe(false);
  });

  it("режет ожидаемые ApiError 4xx, пропускает 5xx и обычные ошибки", () => {
    expect(isNoiseError(new ApiError("not found", "NOT_FOUND", 404))).toBe(
      true,
    );
    expect(isNoiseError(new ApiError("denied", "FORBIDDEN", 403))).toBe(true);
    expect(isNoiseError(new ApiError("down", "INTERNAL_ERROR", 500))).toBe(
      false,
    );
    expect(isNoiseError(new Error("настоящая ошибка"))).toBe(false);
  });
});

describe("reportError — отправка", () => {
  it("шлёт sendBeacon на /api/v1/client-errors с kind/route", () => {
    reportError(new Error(`beacon-check-${Date.now()}`));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url] = sendBeacon.mock.calls[0] as unknown[];
    expect(url).toBe("/api/v1/client-errors");
    const payload = lastBeaconPayload();
    expect(payload.kind).toBe("error");
    expect(payload.route).toBe("/");
  });

  it("route берётся из location.hash (HashRouter), а не из pathname", () => {
    window.location.hash = `#/search-${Date.now()}`;
    try {
      reportError(new Error(`hash-route-${Date.now()}`));
      const payload = lastBeaconPayload();
      expect(payload.route).toBe(window.location.hash.slice(1));
    } finally {
      window.location.hash = "";
    }
  });

  it("sendBeacon=false → fallback fetch с keepalive", () => {
    sendBeacon.mockReturnValue(false);
    reportError(new Error(`fallback-check-${Date.now()}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown[] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/client-errors");
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
  });

  it("дедупликация: повтор в минуту не уходит, после TTL — уходит", () => {
    vi.useFakeTimers();
    const message = `dedupe-check-${Date.now()}`;
    reportError(new Error(message));
    reportError(new Error(message));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    reportError(new Error(message));
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("в dev ничего не уходит", () => {
    vi.stubEnv("DEV", true);
    reportError(new Error(`dev-check-${Date.now()}`));
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("шум не отправляется", () => {
    reportError(new Error("ResizeObserver loop limit exceeded"));
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("initErrorReporting — слушатели", () => {
  it("error и unhandledrejection уходят с правильным kind", () => {
    initErrorReporting();
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: `window-error-${Date.now()}`,
        error: new Error("window boom"),
      }),
    );
    const rejected = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    rejected.reason = new Error(`rejection-${Date.now()}`);
    window.dispatchEvent(rejected);

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const kinds = sendBeacon.mock.calls.map((call) =>
      (JSON.parse(call[1] as string) as { kind: string }).kind,
    );
    expect(kinds).toEqual(["error", "unhandledrejection"]);
  });
});

describe("ErrorBoundary — componentDidCatch", () => {
  it("краш ребёнка уходит как kind=boundary с componentStack", () => {
    function Boom(): never {
      throw new Error(`boundary-boom-${Date.now()}`);
    }
    render(
      <ErrorBoundary fallback={() => <div>Упало</div>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const payload = lastBeaconPayload();
    expect(payload.kind).toBe("boundary");
    expect(typeof payload.componentStack).toBe("string");
    expect(document.body.textContent).toContain("Упало");
  });
});
