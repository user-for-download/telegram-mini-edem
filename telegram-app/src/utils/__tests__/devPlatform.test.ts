// Юнит-тесты чистых хелперов dev-переключателей платформы/темы.
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_OPTIONS,
  PLATFORM_OPTIONS,
  choiceLabel,
  nextChoice,
  nextPlatformChoice,
  resolveAppRootPlatform,
} from "@/utils/devPlatform";

describe("nextChoice", () => {
  it("круг по опциям", () => {
    expect(nextChoice(PLATFORM_OPTIONS, "ios")).toBe("android");
    expect(nextChoice(PLATFORM_OPTIONS, "android")).toBe("ios");
  });

  it("null стартует с первой опции", () => {
    expect(nextChoice(PLATFORM_OPTIONS, null)).toBe("ios");
  });
});

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
    expect(choiceLabel(APPEARANCE_OPTIONS, "dark")).toBe("Тёмная");
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
