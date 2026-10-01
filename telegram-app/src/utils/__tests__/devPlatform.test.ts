// Юнит-тесты чистых хелперов dev-переключателей платформы/темы.
import { describe, expect, it } from "vitest";
import {
  PLATFORM_OPTIONS,
  choiceLabel,
  nextPlatformChoice,
  resolveAppRootPlatform,
} from "@/utils/devPlatform";

describe("nextPlatformChoice", () => {
  it("круг с возвратом в Авто", () => {
    expect(nextPlatformChoice(null)).toBe("ios");
    expect(nextPlatformChoice("ios")).toBe("android");
    expect(nextPlatformChoice("android")).toBeNull();
  });
});

describe("choiceLabel", () => {
  it("null — Авто", () => {
    expect(choiceLabel(PLATFORM_OPTIONS, null)).toBe("Авто");
    expect(choiceLabel(PLATFORM_OPTIONS, "ios")).toBe("iOS");
    // choiceLabel работает с любым списком опций ( APPEARANCE_OPTIONS
    // удалён как мёртвый — тема переключается отдельным циклом в
    // DevToggles, а не общим списком).
    expect(choiceLabel(PLATFORM_OPTIONS, "android")).toBe("Android");
  });
});

describe("resolveAppRootPlatform", () => {
  it("оверрайд важнее фолбэка клиента", () => {
    expect(resolveAppRootPlatform("ios", "base")).toBe("ios");
    expect(resolveAppRootPlatform("android", "ios")).toBe("base");
    expect(resolveAppRootPlatform(null, "ios")).toBe("ios");
    expect(resolveAppRootPlatform(null, "base")).toBe("base");
  });
});
