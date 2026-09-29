// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * toSnakeThemeParams (init.ts): нормализация темы для theme_changed.
 *
 * Факт (.d.ts + рантайм 3.0.23): themeParams.state() и launchParams
 * уже snake_case — проход идемпотентен. Конвертер страхует от
 * camelCase-источника (так было в @telegram-apps 3.3.x).
 */

vi.mock("@tma.js/sdk-react", () => ({
  setDebug: vi.fn(),
  init: vi.fn(),
  mockTelegramEnv: vi.fn(),
  emitEvent: vi.fn(),
  retrieveLaunchParams: vi.fn(),
  themeParams: {
    state: vi.fn(),
    mount: { isAvailable: () => false, ifAvailable: vi.fn() },
    bindCssVars: vi.fn(),
  },
  miniApp: { mount: { isAvailable: () => false, ifAvailable: vi.fn() } },
  backButton: { mount: { ifAvailable: vi.fn() } },
  settingsButton: { mount: { ifAvailable: vi.fn() } },
  closingBehavior: { mount: { ifAvailable: vi.fn() } },
  initData: { restore: vi.fn() },
  viewport: {
    mount: { isAvailable: () => false },
    bindCssVars: vi.fn(),
    expand: { ifAvailable: vi.fn() },
  },
}));

import { toSnakeThemeParams } from "@/init";

describe("toSnakeThemeParams", () => {
  it("snake_case проходит без изменений (текущие источники 3.0.23)", () => {
    const snake = {
      bg_color: "#17212b",
      text_color: "#f5f5f5",
      section_header_text_color: "#6ab3f3",
    } as const;
    expect(toSnakeThemeParams({ ...snake })).toEqual(snake);
  });

  it("camelCase конвертируется в snake_case", () => {
    expect(
      toSnakeThemeParams({
        bgColor: "#17212b",
        textColor: "#f5f5f5",
        sectionHeaderTextColor: "#6ab3f3",
        bottomBarBgColor: "#000000",
      })
    ).toEqual({
      bg_color: "#17212b",
      text_color: "#f5f5f5",
      section_header_text_color: "#6ab3f3",
      bottom_bar_bg_color: "#000000",
    });
  });

  it("undefined-значения и смешанные ключи сохраняются", () => {
    expect(
      toSnakeThemeParams({ bgColor: undefined, text_color: "#fff" })
    ).toEqual({ bg_color: undefined, text_color: "#fff" });
  });
});
