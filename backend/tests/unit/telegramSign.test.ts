// backend/tests/unit/telegramSign.test.ts
// Юнит-тесты верификации Telegram initData (telegramSign.ts).
// Покрытие: реальная HMAC-валидация (sign() из пакета), просрочка,
// битая подпись, dev-bypass (hash=dev-hash: точное совпадение, валидный
// user.id без дефолта), fail-closed без токена, initData без user.
//
// env/logger замоканы — сетевых вызовов нет;
// криптография пакета @tma.js/init-data-node — настоящая.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "@tma.js/init-data-node";

const envMocks = vi.hoisted(() => ({
  NODE_ENV: "test",
  isProduction: false,
  ALLOW_DEV_AUTH: true,
  TELEGRAM_BOT_TOKEN: "",
  TG_INIT_DATA_TTL_SECONDS: 3600,
}));

vi.mock("../../src/env.js", () => ({ env: envMocks }));
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { verifyTelegramInitData } = await import("../../src/auth/telegramSign.js");

// Тестовый токен из документации пакета (публичный пример, не секрет).
const TEST_TOKEN = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";

/** Подписанная initData с реальным HMAC (пакет, не ручная сборка). */
function signedInitData(
  user: Record<string, unknown>,
  authDate: Date = new Date(),
): string {
  return sign({ user: JSON.stringify(user) }, TEST_TOKEN, authDate);
}

/** Dev-формат: hash=dev-hash + urlencoded user JSON. */
function devInitData(user: Record<string, unknown>, hash = "dev-hash"): string {
  return new URLSearchParams([
    ["user", JSON.stringify(user)],
    ["hash", hash],
  ]).toString();
}

beforeEach(() => {
  envMocks.TELEGRAM_BOT_TOKEN = "";
  envMocks.ALLOW_DEV_AUTH = true;
  envMocks.isProduction = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("verifyTelegramInitData: реальная валидация", () => {
  beforeEach(() => {
    envMocks.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  });

  it("принимает валидную подпись и извлекает user", () => {
    const initData = signedInitData({
      id: 279058397,
      first_name: "Владислав",
      last_name: "Кибенко",
      username: "vdkfrost",
      photo_url: "https://t.me/i/userpic/320/abc.svg",
    });

    const result = verifyTelegramInitData(initData);

    expect(result.isValid).toBe(true);
    expect(result.telegramUserId).toBe(279058397n);
    expect(result.user).toEqual({
      id: 279058397,
      firstName: "Владислав",
      lastName: "Кибенко",
      username: "vdkfrost",
      photoUrl: "https://t.me/i/userpic/320/abc.svg",
    });
  });

  it("принимает id больше Int32 (BigInt-домен Telegram)", () => {
    const initData = signedInitData({ id: 7000000000, first_name: "Big" });
    const result = verifyTelegramInitData(initData);
    expect(result.isValid).toBe(true);
    expect(result.telegramUserId).toBe(7000000000n);
  });

  it("отклоняет испорченную подпись", () => {
    const initData = signedInitData({ id: 1, first_name: "X" });
    const corrupted = initData.slice(0, -4) + "beef";
    expect(verifyTelegramInitData(corrupted).isValid).toBe(false);
  });

  it("отклоняет просроченную initData (TTL)", () => {
    const initData = signedInitData(
      { id: 1, first_name: "X" },
      new Date(Date.now() - 2 * 3600 * 1000),
    );
    expect(verifyTelegramInitData(initData).isValid).toBe(false);
  });

  it("отклоняет чужой токен (подпись другим ключом)", () => {
    const otherSigned = sign(
      { user: JSON.stringify({ id: 1, first_name: "X" }) },
      "1111111111:AAAdifferent-token-entirely-xxxxxxxxx",
      new Date(),
    );
    expect(verifyTelegramInitData(otherSigned).isValid).toBe(false);
  });

  it("отклоняет подписанные данные без user (fail-closed на parse)", () => {
    // Подпись валидна, но user-объекта нет — для auth бесполезно.
    const noUser = sign({ auth_date: Math.floor(Date.now() / 1000) }, TEST_TOKEN, new Date());
    expect(verifyTelegramInitData(noUser).isValid).toBe(false);
  });
});

describe("verifyTelegramInitData: dev-bypass", () => {
  it("принимает точный dev-hash с валидным user.id", () => {
    const result = verifyTelegramInitData(devInitData({ id: 9800501, first_name: "Dev" }));
    expect(result.isValid).toBe(true);
    expect(result.telegramUserId).toBe(9800501n);
    expect(result.user?.firstName).toBe("Dev");
  });

  it("отклоняет near-miss dev-hash (подстрока, не точное совпадение)", () => {
    expect(
      verifyTelegramInitData(devInitData({ id: 1 }, "dev-hash-evil")).isValid
    ).toBe(false);
  });

  it("отклоняет отсутствующего user (без дефолтного id)", () => {
    const noUser = new URLSearchParams([["hash", "dev-hash"]]).toString();
    expect(verifyTelegramInitData(noUser).isValid).toBe(false);
  });

  it("отклоняет невалидный user.id (не число/отрицательный/дробный)", () => {
    expect(verifyTelegramInitData(devInitData({ id: -5 })).isValid).toBe(false);
    expect(verifyTelegramInitData(devInitData({ id: 1.5 })).isValid).toBe(false);
    expect(verifyTelegramInitData(devInitData({ id: "123" })).isValid).toBe(false);
    expect(verifyTelegramInitData(devInitData({})).isValid).toBe(false);
  });
});

describe("verifyTelegramInitData: fail-closed", () => {
  it("без токена и без dev-режима — невалидно (роут отвечает 503)", () => {
    envMocks.ALLOW_DEV_AUTH = false;
    expect(verifyTelegramInitData(devInitData({ id: 1 })).isValid).toBe(false);
  });

  it("dev-bypass не работает в production", () => {
    envMocks.isProduction = true;
    expect(verifyTelegramInitData(devInitData({ id: 1 })).isValid).toBe(false);
  });
});
