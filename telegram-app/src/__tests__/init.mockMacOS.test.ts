// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * init.ts (macOS-mock): onEvent в объектной форме { name, params }.
 *
 * .d.ts 3.0.23: mockTelegramEnv({ onEvent(event, next) }), где event —
 * { name, params }. Тест захватывает onEvent через замоканный SDK и
 * вызывает его объектами (как это делает рантайм), проверяя 3 ветки:
 * theme / safe_area / fullscreen + passthrough неизвестных методов.
 * Отдельно: порядок маунтов (themeParams → miniApp, синхронно, по разу).
 */

const { sdk } = vi.hoisted(() => {
  // mount в SDK — вызываемая WithChecks-функция с полями isAvailable/
  // ifAvailable: эмулируем через Object.assign.
  const mkCallableMount = () =>
    Object.assign(vi.fn(), { isAvailable: vi.fn(), ifAvailable: vi.fn() });
  return {
    sdk: {
      mockSetDebug: vi.fn(),
      mockInitSDK: vi.fn(),
      mockMockTelegramEnv: vi.fn(),
      mockEmitEvent: vi.fn(),
      mockRetrieveLaunchParams: vi.fn(),
      mockThemeState: vi.fn(),
      themeMount: mkCallableMount(),
      themeBind: vi.fn(),
      miniMount: mkCallableMount(),
      backMount: mkCallableMount(),
      settingsMount: mkCallableMount(),
      closingMount: mkCallableMount(),
      swipeMount: mkCallableMount(),
      swipeDisableVertical: mkCallableMount(),
      initDataRestore: vi.fn(),
      viewportMount: mkCallableMount(),
      viewportBind: vi.fn(),
      viewportExpand: { ifAvailable: vi.fn() },
    },
  };
});

vi.mock("@tma.js/sdk-react", () => ({
  setDebug: sdk.mockSetDebug,
  init: sdk.mockInitSDK,
  mockTelegramEnv: sdk.mockMockTelegramEnv,
  emitEvent: sdk.mockEmitEvent,
  retrieveLaunchParams: sdk.mockRetrieveLaunchParams,
  themeParams: {
    state: sdk.mockThemeState,
    mount: sdk.themeMount,
    bindCssVars: sdk.themeBind,
  },
  miniApp: { mount: sdk.miniMount },
  backButton: { mount: sdk.backMount },
  settingsButton: { mount: sdk.settingsMount },
  closingBehavior: { mount: sdk.closingMount },
  swipeBehavior: {
    mount: sdk.swipeMount,
    disableVertical: sdk.swipeDisableVertical,
  },
  initData: { restore: sdk.initDataRestore },
  viewport: {
    mount: sdk.viewportMount,
    bindCssVars: sdk.viewportBind,
    expand: sdk.viewportExpand,
  },
}));

import { init } from "@/init";

type OnEvent = (
  event: { name: string; params?: unknown },
  next: () => void
) => void;

const LAUNCH_THEME = {
  bg_color: "#ffffff",
  text_color: "#000000",
} as const;
const LIVE_THEME = {
  bg_color: "#17212b",
  text_color: "#f5f5f5",
} as const;

function capturedOnEvent(): OnEvent {
  expect(sdk.mockMockTelegramEnv).toHaveBeenCalledTimes(1);
  const opts = sdk.mockMockTelegramEnv.mock.calls[0]?.[0] as
    | { onEvent: OnEvent }
    | undefined;
  expect(opts?.onEvent).toBeTypeOf("function");
  return (opts as { onEvent: OnEvent }).onEvent;
}

describe("init macOS-mock onEvent (объектная форма)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.themeMount.isAvailable.mockReturnValue(true);
    sdk.miniMount.isAvailable.mockReturnValue(true);
    sdk.viewportMount.isAvailable.mockReturnValue(false);
    sdk.mockRetrieveLaunchParams.mockReturnValue({
      tgWebAppThemeParams: LAUNCH_THEME,
    });
    sdk.mockThemeState.mockReturnValue(LIVE_THEME);
  });

  it("без mockForMacOS мок окружения не ставится", async () => {
    await init({ debug: false, mockForMacOS: false });
    expect(sdk.mockMockTelegramEnv).not.toHaveBeenCalled();
  });

  it("web_app_request_theme: первый раз — тема launch params, дальше — live state", async () => {
    await init({ debug: false, mockForMacOS: true });
    const onEvent = capturedOnEvent();
    const next = vi.fn();

    onEvent({ name: "web_app_request_theme" }, next);
    expect(sdk.mockEmitEvent).toHaveBeenCalledWith("theme_changed", {
      theme_params: LAUNCH_THEME,
    });

    onEvent({ name: "web_app_request_theme" }, next);
    expect(sdk.mockEmitEvent).toHaveBeenLastCalledWith("theme_changed", {
      theme_params: LIVE_THEME,
    });
    expect(sdk.mockThemeState).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("web_app_request_safe_area → safe_area_changed с нулевыми врезками", async () => {
    await init({ debug: false, mockForMacOS: true });
    const onEvent = capturedOnEvent();

    onEvent({ name: "web_app_request_safe_area" }, vi.fn());
    expect(sdk.mockEmitEvent).toHaveBeenCalledWith("safe_area_changed", {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });

  it("fullscreen-методы → fullscreen_changed без отказа", async () => {
    await init({ debug: false, mockForMacOS: true });
    const onEvent = capturedOnEvent();

    onEvent({ name: "web_app_request_fullscreen" }, vi.fn());
    expect(sdk.mockEmitEvent).toHaveBeenCalledWith("fullscreen_changed", {
      is_fullscreen: false,
    });

    onEvent({ name: "web_app_request_exit_fullscreen" }, vi.fn());
    expect(sdk.mockEmitEvent).toHaveBeenLastCalledWith("fullscreen_changed", {
      is_fullscreen: false,
    });
  });

  it("неизвестный метод уходит в next(), emitEvent не зовём", async () => {
    await init({ debug: false, mockForMacOS: true });
    const onEvent = capturedOnEvent();
    const next = vi.fn();

    onEvent({ name: "web_app_request_viewport" }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(sdk.mockEmitEvent).not.toHaveBeenCalled();
  });

  it("порядок маунтов: themeParams.mount → bindCssVars → miniApp.mount, каждый ровно раз", async () => {
    await init({ debug: false, mockForMacOS: false });

    expect(sdk.themeMount.isAvailable).toHaveBeenCalledTimes(1);
    expect(sdk.miniMount.isAvailable).toHaveBeenCalledTimes(1);
    const order = [
      sdk.themeMount.isAvailable.mock.invocationCallOrder[0] ?? -1,
      sdk.themeBind.mock.invocationCallOrder[0] ?? -1,
      sdk.miniMount.isAvailable.mock.invocationCallOrder[0] ?? -1,
    ];
    const [tMount, tBind, mMount] = order;
    expect(tMount).toBeGreaterThanOrEqual(0);
    expect(tBind).toBeGreaterThanOrEqual(0);
    expect(mMount).toBeGreaterThanOrEqual(0);
    expect(tMount).toBeLessThan(tBind as number);
    expect(tBind).toBeLessThan(mMount as number);
  });

  it("отключает вертикальный свайп глобально после mount", async () => {
    await init({ debug: false, mockForMacOS: false });

    expect(sdk.swipeMount.ifAvailable).toHaveBeenCalledTimes(1);
    expect(sdk.swipeDisableVertical.ifAvailable).toHaveBeenCalledTimes(1);
    expect(
      sdk.swipeMount.ifAvailable.mock.invocationCallOrder[0],
    ).toBeLessThan(
      sdk.swipeDisableVertical.ifAvailable.mock.invocationCallOrder[0] as number,
    );
  });
});
