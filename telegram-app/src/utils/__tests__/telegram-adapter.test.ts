import { beforeEach, describe, expect, it, vi } from "vitest";

// Граница SDK мокается целиком: адаптер тестируется без Telegram-клиента.
vi.mock("@telegram-apps/sdk-react", () => ({
  retrieveRawInitData: vi.fn(),
  miniApp: { ready: { ifAvailable: vi.fn() } },
  shareURL: { ifAvailable: vi.fn(), isAvailable: () => true },
  openTelegramLink: { ifAvailable: vi.fn(), isAvailable: () => true },
}));

import {
  miniApp,
  openTelegramLink,
  retrieveRawInitData,
  shareURL,
} from "@telegram-apps/sdk-react";
import {
  buildTelegramChatUrl,
  buildTelegramShareLink,
  getRawInitData,
  openTelegramUrl,
  shareViaTelegram,
  signalAppReady,
} from "@/utils/telegram-adapter";

const mockedRetrieve = vi.mocked(retrieveRawInitData);
const mockedReady = vi.mocked(miniApp.ready.ifAvailable);
const mockedShare = vi.mocked(shareURL.ifAvailable);
const mockedOpen = vi.mocked(openTelegramLink.ifAvailable);

const RAW =
  "user=%7B%22id%22%3A9800001%7D&auth_date=1788947253&hash=dev-hash";

describe("getRawInitData", () => {
  beforeEach(() => {
    mockedRetrieve.mockReset();
  });

  it("возвращает сырую строку SDK побайтово (HMAC)", () => {
    mockedRetrieve.mockReturnValue(RAW);
    expect(getRawInitData()).toBe(RAW);
  });

  it("fail-closed: исключение SDK → undefined", () => {
    mockedRetrieve.mockImplementation(() => {
      throw new Error("not in TMA");
    });
    expect(getRawInitData()).toBeUndefined();
  });

  it("fail-closed: пустое значение SDK → undefined", () => {
    mockedRetrieve.mockReturnValue(undefined as unknown as string);
    expect(getRawInitData()).toBeUndefined();
  });
});

describe("signalAppReady", () => {
  it("вызывает miniApp.ready.ifAvailable один раз", () => {
    signalAppReady();
    expect(mockedReady).toHaveBeenCalledTimes(1);
  });
});

describe("buildTelegramShareLink", () => {
  it("строит t.me/share/url с %20 вместо +", () => {
    const link = buildTelegramShareLink(
      "https://example.com/?startapp=trip_1",
      "Поехали вместе!",
    );
    expect(link.startsWith("https://t.me/share/url?")).toBe(true);
    expect(link).toContain("url=");
    expect(link).toContain("%20");
    expect(link).not.toContain("+");
  });
});

describe("shareViaTelegram", () => {
  beforeEach(() => {
    mockedShare.mockReset();
  });

  it("успех SDK → true", () => {
    expect(shareViaTelegram("https://example.com/", "text")).toBe(true);
    expect(mockedShare).toHaveBeenCalledWith("https://example.com/", "text");
  });

  it("исключение SDK → false (fallback вызывающего)", () => {
    mockedShare.mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(shareViaTelegram("https://example.com/", "text")).toBe(false);
  });

  it("метод недоступен (старый клиент) → false без вызова SDK", () => {
    vi.spyOn(shareURL, "isAvailable").mockReturnValueOnce(false);
    expect(shareViaTelegram("https://example.com/", "text")).toBe(false);
    expect(mockedShare).not.toHaveBeenCalled();
  });
});

describe("buildTelegramChatUrl", () => {
  it("срезает @ и собирает t.me-ссылку", () => {
    expect(buildTelegramChatUrl("@driver_1")).toBe("https://t.me/driver_1");
    expect(buildTelegramChatUrl("driver_1")).toBe("https://t.me/driver_1");
  });

  it("пустое/отсутствующее имя → null (ничего не раскрываем)", () => {
    expect(buildTelegramChatUrl(undefined)).toBeNull();
    expect(buildTelegramChatUrl("")).toBeNull();
    expect(buildTelegramChatUrl("   @  ")).toBeNull();
  });
});

describe("openTelegramUrl", () => {
  beforeEach(() => {
    mockedOpen.mockReset();
  });

  it("успех SDK → true", () => {
    expect(openTelegramUrl("https://t.me/driver_1")).toBe(true);
    expect(mockedOpen).toHaveBeenCalledWith("https://t.me/driver_1");
  });

  it("не-t.me URL (SDK бросает) → false", () => {
    mockedOpen.mockImplementation(() => {
      throw new Error("invalid URL");
    });
    expect(openTelegramUrl("https://evil.example/phish")).toBe(false);
  });

  it("метод недоступен (старый клиент) → false без вызова SDK", () => {
    vi.spyOn(openTelegramLink, "isAvailable").mockReturnValueOnce(false);
    expect(openTelegramUrl("https://t.me/driver_1")).toBe(false);
    expect(mockedOpen).not.toHaveBeenCalled();
  });
});
