// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (паттерн hooks/__tests__).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * useTelegramAppearance → нативный хром Telegram.
 *
 * Контраст статус-бара и плавающих кнопок фуллскрина на iOS клиент выбирает
 * по ЦВЕТУ ШАПКИ, и только в ветке hex: keyword (bg_color/secondary_bg_color)
 * уходит событием как color_key и оставляет клиентский дефолт .White —
 * белые часы и батарея на светлом фоне (Telegram-iOS, WebAppController.
 * updateHeaderBackgroundColor → fullScreenStatusBarStyle). Тест фиксирует,
 * что в setHeaderColor уходит конкретный hex эффективного фона приложения.
 */

const { mockHeader, mockBackground, mockBottomBar } = vi.hoisted(() => ({
  mockHeader: vi.fn(),
  mockBackground: vi.fn(),
  mockBottomBar: vi.fn(),
}));

/** Состояние «клиента», читаемое моком SDK (меняется тестом напрямую). */
let mockTgDark: boolean;
let mockClientBg: string | undefined;
let mockThemeOverride: "dark" | "light" | null;

vi.mock("@telegram-apps/sdk-react", () => ({
  useSignal: (signal: () => unknown) => signal(),
  miniApp: { isDark: () => mockTgDark },
  themeParams: {
    backgroundColor: () => mockClientBg,
    state: () => ({}),
  },
  setMiniAppHeaderColor: { ifAvailable: mockHeader },
  setMiniAppBackgroundColor: { ifAvailable: mockBackground },
  setMiniAppBottomBarColor: { ifAvailable: mockBottomBar },
}));

vi.mock("@/utils/appSettings", () => ({
  useAppSettings: () => ({
    themeOverride: mockThemeOverride,
    soundEnabled: true,
  }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTelegramAppearance } from "@/AppConfig";

function Host(): null {
  useTelegramAppearance();
  return null;
}

describe("useTelegramAppearance (хром Telegram)", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTgDark = false;
    mockClientBg = "#ffffff";
    mockThemeOverride = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.documentElement.classList.remove("dark");
  });

  function renderHost(): void {
    act(() => {
      root.render(<Host />);
    });
  }

  it("светлая тема клиента: в шапку уходит hex фона, а не keyword", () => {
    renderHost();

    expect(mockHeader).toHaveBeenCalledWith("#ffffff");
    expect(mockBackground).toHaveBeenCalledWith("#ffffff");
    // Ни один вызов не должен уходить keyword'ом: на iOS это дефолтный
    // .White у статус-бара, т.е. невидимые часы на светлом фоне.
    for (const [color] of mockHeader.mock.calls) {
      expect(["bg_color", "secondary_bg_color"]).not.toContain(color);
    }
  });

  it("тёмная тема клиента: тёмный hex (клиент выберет светлый статус-бар)", () => {
    mockTgDark = true;
    mockClientBg = "#17212b";
    renderHost();

    expect(mockHeader).toHaveBeenCalledWith("#17212b");
  });

  it("оверрайд «тёмная» важнее светлой темы клиента", () => {
    mockThemeOverride = "dark";
    renderHost();

    expect(mockHeader).toHaveBeenCalledWith("#17212b");
    expect(mockBackground).toHaveBeenCalledWith("#17212b");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("оверрайд «светлая» важнее тёмной темы клиента", () => {
    mockTgDark = true;
    mockClientBg = "#17212b";
    mockThemeOverride = "light";
    renderHost();

    expect(mockHeader).toHaveBeenCalledWith("#ffffff");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("нижняя полоса — по-прежнему keyword secondary_bg_color", () => {
    renderHost();

    expect(mockBottomBar).toHaveBeenCalledWith("secondary_bg_color");
  });
});
