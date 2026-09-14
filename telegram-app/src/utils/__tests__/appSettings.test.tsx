// Тесты локальных настроек: стор (localStorage) + гейт haptics.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: {
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import {
  getThemeOverride,
  isSoundEnabled,
  setSoundEnabled,
  setThemeOverride,
} from "@/utils/appSettings";

// Vitest работает в node-окружении без localStorage — минимальный стаб.
const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
};
vi.stubGlobal("localStorage", localStorageStub);

beforeEach(() => {
  storage.clear();
  setThemeOverride(null);
  setSoundEnabled(true);
});

describe("appSettings store", () => {
  it("тема по умолчанию из Telegram (null), переопределение сохраняется", () => {
    expect(getThemeOverride()).toBe(null);
    setThemeOverride("dark");
    expect(getThemeOverride()).toBe("dark");
    setThemeOverride("light");
    expect(getThemeOverride()).toBe("light");
    setThemeOverride(null);
    expect(getThemeOverride()).toBe(null);
  });

  it("звук по умолчанию включён, выключается флагом", () => {
    expect(isSoundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it("битый localStorage не роняет чтение", () => {
    const getItem = vi
      .spyOn(localStorageStub, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(getThemeOverride()).toBe(null);
    expect(isSoundEnabled()).toBe(true);
    getItem.mockRestore();
  });
});

describe("haptics gate", () => {
  it("выключенный звук глушит haptic", async () => {
    const sdk = await import("@telegram-apps/sdk-react");
    const selection = vi.mocked(sdk.hapticFeedback.selectionChanged.ifAvailable);
    const { haptic } = await import("@/utils/haptics");
    haptic.selection();
    expect(selection).toHaveBeenCalledTimes(1);
    setSoundEnabled(false);
    haptic.selection();
    haptic.success();
    expect(selection).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(sdk.hapticFeedback.notificationOccurred.ifAvailable),
    ).not.toHaveBeenCalled();
    setSoundEnabled(true);
  });

  it("SSR-рендер не падает без localStorage", () => {
    const html = renderToString(<div>ok</div>);
    expect(html).toContain("ok");
  });
});
