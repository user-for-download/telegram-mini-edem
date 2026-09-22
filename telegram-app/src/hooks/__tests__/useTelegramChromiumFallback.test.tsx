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
 * теста, инвессы — vi.fn с семантикой ifAvailable (undefined при
 * недоступности). Порог читается через getComputedStyle — jsdom
 * возвращает пустую строку, срабатывает фолбэк 56px (константа хука).
 */

const { mockRequestContent, mockRequestSafe } = vi.hoisted(() => ({
  mockRequestContent: vi.fn(),
  mockRequestSafe: vi.fn(),
}));

/** Состояние «клиента», читаемое моком SDK (меняется тестом напрямую). */
let mockPlatform: string;
let mockFullscreen: boolean;
let mockSafeTop: number;
let mockContentTop: number;

vi.mock("@telegram-apps/sdk-react", () => ({
  useSignal: (signal: () => unknown) => signal(),
  useLaunchParams: () => ({ tgWebAppPlatform: mockPlatform }),
  requestContentSafeAreaInsets: { ifAvailable: mockRequestContent },
  requestSafeAreaInsets: { ifAvailable: mockRequestSafe },
  viewport: {
    isFullscreen: () => mockFullscreen,
    safeAreaInsetTop: () => mockSafeTop,
    contentSafeAreaInsetTop: () => mockContentTop,
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
    mockPlatform = "ios";
    mockFullscreen = true;
    mockSafeTop = 0;
    mockContentTop = 0;
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

  it("iOS-фуллскрин с нулевыми врезками: ставит floor и пинает клиента", () => {
    renderHost();

    expect(
      document.documentElement.style.getPropertyValue(OVERRIDE)
    ).toBe("var(--tg-telegram-chromium-height)");
    expect(mockRequestContent).toHaveBeenCalledTimes(1);
    expect(mockRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("честная врезка >= порога: floor не ставится, пингов нет", () => {
    mockContentTop = 96;
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequestContent).not.toHaveBeenCalled();
    expect(mockRequestSafe).not.toHaveBeenCalled();
  });

  it("врезка пришла позже: floor снимается, повторных пингов нет", () => {
    renderHost();
    expect(
      document.documentElement.style.getPropertyValue(OVERRIDE)
    ).toBe("var(--tg-telegram-chromium-height)");

    // Ответ клиента на пинок: сигналы обновились → хук снял floor.
    mockContentTop = 96;
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequestContent).toHaveBeenCalledTimes(1);
    expect(mockRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("не-фуллскрин: floor снимается и не ставится заново", () => {
    document.documentElement.style.setProperty(OVERRIDE, "1px");
    mockFullscreen = false;
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequestContent).not.toHaveBeenCalled();
  });

  it("не-iOS платформа во фуллскрине: floor не ставится", () => {
    mockPlatform = "android";
    renderHost();

    expect(document.documentElement.style.getPropertyValue(OVERRIDE)).toBe("");
    expect(mockRequestContent).not.toHaveBeenCalled();
  });
});
