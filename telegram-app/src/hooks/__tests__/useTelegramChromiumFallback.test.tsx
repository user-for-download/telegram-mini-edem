// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * useTelegramChromiumFallback — компенсация нулевой/заниженной верхней
 * врезки на iOS-фуллскрине (реальное устройство: iPhone 11, Telegram
 * 12.9.4; тикеты tma.js #695/#704, Telegram-iOS#1377).
 *
 * Паттерн WebSocketProvider.test.tsx: react-dom/client + act, без
 * testing-library. SDK-модуль замокан: useSignal читает замыкания
 * теста, врезки — объектные сигналы 3.0.x (safeAreaInsets/
 * contentSafeAreaInsets), request — vi.fn с семантикой fire-and-forget
 * (возвращает { catch } — ошибки гасятся, как старый ifAvailable).
 * Порог читается через getComputedStyle — jsdom возвращает пустую
 * строку, срабатывает фолбэк 88px (константа хука).
 */

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}));

/** Состояние «клиента», читаемое моком SDK (меняется тестом напрямую). */
let mockPlatform: string;
let mockFullscreen: boolean;
let mockSafeInsets: { top: number; bottom: number; left: number; right: number };
let mockContentInsets: {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

vi.mock("@tma.js/sdk-react", () => ({
  useSignal: (signal: () => unknown) => signal(),
  useLaunchParams: () => ({ tgWebAppPlatform: mockPlatform }),
  request: mockRequest,
  viewport: {
    isFullscreen: () => mockFullscreen,
    safeAreaInsets: () => mockSafeInsets,
    contentSafeAreaInsets: () => mockContentInsets,
  },
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTelegramChromiumFallback } from "@/hooks/useTelegramChromiumFallback";

const OVERRIDE = "--tg-safe-area-top-min";

function Host(): null {
  useTelegramChromiumFallback();
  return null;
}

describe("useTelegramChromiumFallback", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReturnValue({ catch: vi.fn() });
    mockPlatform = "ios";
    mockFullscreen = true;
    mockSafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    mockContentInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.documentElement.style.removeProperty(OVERRIDE);
  });

  function renderHost(): void {
    act(() => {
      root.render(<Host />);
    });
  }

  it("iOS-фуллскрин с нулевыми врезками: ставит floor и пинает клиента через request()", () => {
    renderHost();

    expect(
      document.documentElement.style.getPropertyValue(OVERRIDE)
    ).toBe("var(--tg-telegram-chromium-height)");
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenCalledWith(
      "web_app_request_safe_area",
      "safe_area_changed"
    );
    expect(mockRequest).toHaveBeenCalledWith(
      "web_app_request_content_safe_area",
      "content_safe_area_changed"
    );
  });

  it("честная врезка >= порога: floor не ставится, пингов нет", () => {
    mockContentInsets = { top: 96, bottom: 0, left: 0, right: 0 };
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("читает top из объектных сигналов: боковые/нижняя врезки floor не снимают", () => {
    // Только left/right/bottom ненулевые — верх всё ещё под хромом.
    mockSafeInsets = { top: 0, bottom: 34, left: 10, right: 10 };
    mockContentInsets = { top: 0, bottom: 34, left: 10, right: 10 };
    renderHost();

    expect(
      document.documentElement.style.getPropertyValue(OVERRIDE)
    ).toBe("var(--tg-telegram-chromium-height)");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("врезка пришла позже: floor снимается, повторных пингов нет", () => {
    renderHost();
    expect(
      document.documentElement.style.getPropertyValue(OVERRIDE)
    ).toBe("var(--tg-telegram-chromium-height)");

    // Ответ клиента на пинок: сигналы обновились → хук снял floor.
    mockContentInsets = { top: 96, bottom: 0, left: 0, right: 0 };
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("не-фуллскрин: floor снимается и не ставится заново", () => {
    document.documentElement.style.setProperty(OVERRIDE, "1px");
    mockFullscreen = false;
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("не-iOS платформа во фуллскрине: floor не ставится", () => {
    mockPlatform = "android";
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
