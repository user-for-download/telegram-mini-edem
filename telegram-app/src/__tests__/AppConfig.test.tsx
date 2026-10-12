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

// Класс ошибки SDK «мы вне Telegram» объявлен В hoisted-блоке: vi.mock
// поднимается в начало файла и не увидит обычный top-level class.
const { mockHeader, mockBackground, mockBottomBar, LaunchParamsRetrieveErrorMock } =
  vi.hoisted(() => ({
  mockHeader: vi.fn(),
  mockBackground: vi.fn(),
  mockBottomBar: vi.fn(),
  LaunchParamsRetrieveErrorMock: class extends Error {},
}));

/** Состояние «клиента», читаемое моком SDK (меняется тестом напрямую). */
let mockTgDark: boolean;
let mockClientPlatform: string;
let mockLaunchParamsThrows: boolean;
let mockClientBg: string | undefined;
let mockThemeOverride: "dark" | "light" | null;

// Платформа читается через retrieveLaunchParams. Мок обязан её отдавать:
// без него вызов падал бы TypeError, и новый узкий catch (ломающий TypeError
// наружу) уронил бы тест — то есть отсутствие мока больше не маскируется.
vi.mock("@tma.js/sdk-react", () => ({
  retrieveLaunchParams: () => {
    if (mockLaunchParamsThrows) {
      // Именно тот класс, который кидает SDK вне Telegram. Обычный Error
      // узкий catch НЕ глотает — это и проверяется отдельным тестом.
      throw new LaunchParamsRetrieveErrorMock();
    }
    return { tgWebAppPlatform: mockClientPlatform };
  },
  InvalidLaunchParamsError: class extends Error {},
  LaunchParamsRetrieveError: LaunchParamsRetrieveErrorMock,
  useSignal: (signal: () => unknown) => signal(),
  miniApp: {
    isDark: () => mockTgDark,
    setHeaderColor: { ifAvailable: mockHeader },
    setBgColor: { ifAvailable: mockBackground },
    setBottomBarColor: { ifAvailable: mockBottomBar },
  },
  themeParams: {
    bgColor: () => mockClientBg,
    state: () => ({}),
  },
}));

vi.mock("@/utils/appSettings", () => ({
  useAppSettings: () => ({
    themeOverride: mockThemeOverride,
    soundEnabled: true,
  }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readClientPlatform, useTelegramAppearance } from "@/AppConfig";

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
    mockClientPlatform = "android";
    mockLaunchParamsThrows = false;
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

/**
 * Платформа клиента для AppRoot.
 *
 * Регресс: платформа читалась как `useLaunchParams()` ВНУТРИ try/catch.
 * useLaunchParams оборачивает вызов в useMemo, поэтому исключение (дев-стенд
 * в браузере) прилетало ВНУТРИ хука, и catch его глушил — внутренний учёт
 * React оставался недописанным. Теперь это обычная функция `readClientPlatform`
 * с try/catch вокруг НЕ-хука.
 */
describe("readClientPlatform", () => {
  it("iOS-клиент даёт ios", () => {
    mockClientPlatform = "ios";
    expect(readClientPlatform()).toBe("ios");
  });

  it("любой другой клиент даёт нейтральный base", () => {
    for (const platform of ["android", "tdesktop", "web", "weba", "ios"] as const) {
      mockClientPlatform = platform;
      expect(readClientPlatform()).toBe(platform === "ios" ? "ios" : "base");
    }
  });

  it("вне Telegram — base, без падения", () => {
    // Штатный случай: дев-стенд открыт в обычном браузере.
    mockLaunchParamsThrows = true;
    expect(readClientPlatform()).toBe("base");
  });

  it("НЕ маскирует постороннюю ошибку под «base»", async () => {
    // Ключевое свойство узкого catch. С catch-all любой сломанный импорт или
    // опечатка тихо превращались в «платформа base» — приложение рисовалось
    // и работало, но неправильно, и сломанный код невозможно было заметить.
    // Мок функции-источника временно становится «сломанным импортом».
    const mod = await import("@tma.js/sdk-react");
    const spy = vi
      .spyOn(mod, "retrieveLaunchParams")
      .mockImplementation(() => {
        throw new TypeError("retrieveLaunchParams is not a function");
      });
    try {
      expect(() => readClientPlatform()).toThrow(TypeError);
    } finally {
      spy.mockRestore();
    }
  });
});
