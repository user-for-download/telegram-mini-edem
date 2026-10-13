import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTripDeepLink,
  buildTripShareLink,
  buildTripStartParam,
  getTelegramBotUsername,
  shareOutcomeFeedback,
  shareTrip,
} from "@/helpers/tripShare";
import { parseTripStartParam } from "@/router/deepLinks";

vi.mock("@/utils/telegram-adapter", () => ({
  getRawInitData: vi.fn(),
  shareViaTelegram: vi.fn(),
}));

import { getRawInitData, shareViaTelegram } from "@/utils/telegram-adapter";

const mockedGetRawInitData = vi.mocked(getRawInitData);
const mockedShareViaTelegram = vi.mocked(shareViaTelegram);

const TRIP_ID = "123e4567-e89b-42d3-a456-426614174000";
const BOT = "edem_mini_bot";

describe("trip share links", () => {
  it("builds the startapp token accepted by the deep-link parser", () => {
    expect(buildTripStartParam(TRIP_ID)).toBe(`trip_${TRIP_ID}`);
  });

  it("builds a web deep link to the trip details route", () => {
    expect(buildTripDeepLink(TRIP_ID, "https://app.example/")).toBe(
      `https://app.example/#/trips/${TRIP_ID}`,
    );
  });

  it("builds a t.me startapp link via the bot username", () => {
    expect(buildTripShareLink(TRIP_ID, BOT)).toBe(
      `https://t.me/${BOT}?startapp=trip_${TRIP_ID}`,
    );
  });

  it("strips a leading @ from the bot username", () => {
    expect(buildTripShareLink(TRIP_ID, `@${BOT} `)).toBe(
      `https://t.me/${BOT}?startapp=trip_${TRIP_ID}`,
    );
  });

  it("uses a startapp token the deep-link parser accepts", () => {
    const link = new URL(buildTripShareLink(TRIP_ID, BOT));
    expect(link.hostname).toBe("t.me");
    expect(parseTripStartParam(link.searchParams.get("startapp"))).toBe(
      TRIP_ID,
    );
  });

  it("falls back to the web deep link without a bot username", () => {
    expect(buildTripShareLink(TRIP_ID, undefined, "https://app.example/")).toBe(
      `https://app.example/#/trips/${TRIP_ID}`,
    );
  });
});

describe("getTelegramBotUsername", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the bot username from env", () => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", BOT);
    expect(getTelegramBotUsername()).toBe(BOT);
  });

  it("strips @ and surrounding spaces", () => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", ` @${BOT} `);
    expect(getTelegramBotUsername()).toBe(BOT);
  });

  it("returns undefined when the env is empty", () => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", "   ");
    expect(getTelegramBotUsername()).toBeUndefined();
  });
});

describe("shareTrip", () => {
  beforeEach(() => {
    mockedGetRawInitData.mockReset();
    mockedShareViaTelegram.mockReset();
    // Дефолт — браузер вне Telegram: нативный шаринг не трогаем.
    mockedGetRawInitData.mockReturnValue(undefined);
    mockedShareViaTelegram.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("внутри Telegram — нативный shareURL первым", async () => {
    mockedGetRawInitData.mockReturnValue("user=%7B%7D&hash=x");
    mockedShareViaTelegram.mockReturnValue(true);
    const share = vi.fn();
    vi.stubGlobal("navigator", { share });
    await expect(shareTrip(TRIP_ID)).resolves.toBe("shared");
    expect(mockedShareViaTelegram).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
  });

  it("шарит startapp-ссылку бота, а не веб-ссылку", async () => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", BOT);
    mockedGetRawInitData.mockReturnValue("user=%7B%7D&hash=x");
    mockedShareViaTelegram.mockReturnValue(true);
    vi.stubGlobal("navigator", {});
    await expect(shareTrip(TRIP_ID)).resolves.toBe("shared");
    expect(mockedShareViaTelegram).toHaveBeenCalledWith(
      `https://t.me/${BOT}?startapp=trip_${TRIP_ID}`,
      expect.any(String),
    );
  });

  it("текст шаринга не дублирует ссылку", async () => {
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", BOT);
    mockedGetRawInitData.mockReturnValue("user=%7B%7D&hash=x");
    mockedShareViaTelegram.mockReturnValue(true);
    vi.stubGlobal("navigator", {});
    await shareTrip(TRIP_ID);
    const [, text] = mockedShareViaTelegram.mock.calls[0] as [string, string];
    expect(text).not.toContain("https://");
    expect(text).not.toContain("t.me");
  });

  it("отказ Telegram-шаринга — откат на Web Share", async () => {
    mockedGetRawInitData.mockReturnValue("user=%7B%7D&hash=x");
    mockedShareViaTelegram.mockReturnValue(false);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareTrip(TRIP_ID)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("uses Web Share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareTrip(TRIP_ID)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("закрытый системный диалог — отмена, а не отправка", async () => {
    const abortError = new Error("Share canceled");
    abortError.name = "AbortError";
    const share = vi.fn().mockRejectedValue(abortError);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    await expect(shareTrip(TRIP_ID)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when Web Share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    // jsdom-less node: location.origin отсутствует — deep link строится от localhost.
    await expect(shareTrip(TRIP_ID)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("reports failure when neither share nor clipboard works", async () => {
    vi.stubGlobal("navigator", {});
    await expect(shareTrip(TRIP_ID)).resolves.toBe("failed");
  });
});

describe("shareOutcomeFeedback", () => {
  it("даёт успех с текстом отправки для shared", () => {
    expect(shareOutcomeFeedback("shared")).toEqual({
      text: "Ссылка отправлена — поделитесь поездкой с попутчиками",
      haptic: "success",
    });
  });

  it("даёт успех с текстом копии для copied", () => {
    expect(shareOutcomeFeedback("copied")).toEqual({
      text: "Ссылка скопирована — поделитесь поездкой с попутчиками",
      haptic: "success",
    });
  });

  it("даёт нейтральный текст без хаптики для cancelled", () => {
    expect(shareOutcomeFeedback("cancelled")).toEqual({
      text: "Отправка отменена — ссылка не отправлена",
      haptic: null,
    });
  });

  it("даёт текст с подсказкой и error-хаптику для failed", () => {
    expect(shareOutcomeFeedback("failed")).toEqual({
      text: "Не удалось поделиться — скопируйте адрес страницы вручную",
      haptic: "error",
    });
  });

  it("тексты всех исходов различимы", () => {
    const texts = (["shared", "copied", "cancelled", "failed"] as const).map(
      (result) => shareOutcomeFeedback(result).text,
    );
    expect(new Set(texts).size).toBe(4);
  });
});
