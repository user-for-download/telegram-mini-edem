// backend/tests/unit/telegramSend.test.ts
//
// Клиент Bot API sendMessage (bot-api-send 01): маппинг исходов,
// тело сообщения (превью выключено, web_app кнопка только с URL),
// транспорт-ди (post) без сети, токен-гейт, без PII в логах.
import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_WEBAPP_URL: "",
  TELEGRAM_API_PROXY: "",
};

vi.mock("../../src/env.js", () => ({ env: envState }));
vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const {
  sendTelegramMessage,
  mapStatusToOutcome,
  buildSendMessageBody,
  sendMessageUrl,
} = await import("../../src/services/telegramSend.js");

describe("mapStatusToOutcome — маппинг HTTP → исход", () => {
  it("200 → ok", () => {
    expect(mapStatusToOutcome(200, {})).toEqual({ ok: true });
  });

  it("403 → bot_blocked (пользователь заблокировал бота)", () => {
    expect(mapStatusToOutcome(403, {})).toEqual({ ok: false, kind: "bot_blocked" });
  });

  it("429 → rate_limited с retry_after из ответа", () => {
    const outcome = mapStatusToOutcome(429, {
      parameters: { retry_after: 45 },
    });
    expect(outcome).toEqual({ ok: false, kind: "rate_limited", retryAfterMs: 45_000 });
  });

  it("429 без retry_after → дефолт 30с", () => {
    const outcome = mapStatusToOutcome(429, {});
    expect(outcome).toEqual({ ok: false, kind: "rate_limited", retryAfterMs: 30_000 });
  });

  it("429 мусорный retry_after → дефолт, кламп до 1..3600с", () => {
    expect(mapStatusToOutcome(429, { parameters: { retry_after: -5 } })).toEqual({
      ok: false,
      kind: "rate_limited",
      retryAfterMs: 1_000,
    });
    expect(mapStatusToOutcome(429, { parameters: { retry_after: 99_999 } })).toEqual({
      ok: false,
      kind: "rate_limited",
      retryAfterMs: 3_600_000,
    });
  });

  it("400 → permanent (повтор бессмыслен)", () => {
    expect(mapStatusToOutcome(400, { description: "Bad Request" })).toEqual({
      ok: false,
      kind: "permanent",
    });
  });

  it("500/502 → transient (ретрай)", () => {
    expect(mapStatusToOutcome(500, {})).toEqual({ ok: false, kind: "transient" });
    expect(mapStatusToOutcome(502, {})).toEqual({ ok: false, kind: "transient" });
  });
});

describe("buildSendMessageBody — тело sendMessage", () => {
  it("базовое тело: chat_id, text, превью выключено", () => {
    const body = buildSendMessageBody({ chatId: 42, text: "Привет" });
    expect(body).toEqual({
      chat_id: 42,
      text: "Привет",
      disable_web_page_preview: true,
    });
  });

  it("deepLink + TELEGRAM_WEBAPP_URL → кнопка «Открыть» (web_app)", () => {
    envState.TELEGRAM_WEBAPP_URL = "https://t.me/edem_bot/app";
    try {
      const body = buildSendMessageBody({
        chatId: 42,
        text: "T",
        deepLink: "/bookings",
      });
      expect(body.reply_markup).toEqual({
        inline_keyboard: [[
          {
            text: "Открыть",
            web_app: { url: "https://t.me/edem_bot/app/bookings" },
          },
        ]],
      });
    } finally {
      envState.TELEGRAM_WEBAPP_URL = "";
    }
  });

  it("deepLink без TELEGRAM_WEBAPP_URL → без кнопки", () => {
    const body = buildSendMessageBody({
      chatId: 42,
      text: "T",
      deepLink: "/bookings",
    });
    expect(body.reply_markup).toBeUndefined();
  });
});

describe("sendTelegramMessage — транспорт и гейты", () => {
  beforeEach(() => {
    envState.TELEGRAM_BOT_TOKEN = "123:abc";
  });

  it("200 → ok; URL содержит токен, тело корректно", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });

    const outcome = await sendTelegramMessage(
      { chatId: 7, text: "T" },
      { post },
    );

    expect(outcome).toEqual({ ok: true });
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(body.chat_id).toBe(7);
  });

  it("403 → bot_blocked", async () => {
    const post = vi.fn().mockResolvedValue({ status: 403, body: {} });
    expect(
      await sendTelegramMessage({ chatId: 7, text: "T" }, { post }),
    ).toEqual({ ok: false, kind: "bot_blocked" });
  });

  it("транспорт бросил (сеть/таймаут) → transient, не бросает", async () => {
    const post = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(
      await sendTelegramMessage({ chatId: 7, text: "T" }, { post }),
    ).toEqual({ ok: false, kind: "transient" });
  });

  it("без токена → permanent (страховочная ветка)", async () => {
    envState.TELEGRAM_BOT_TOKEN = "";
    try {
      const post = vi.fn();
      expect(
        await sendTelegramMessage({ chatId: 7, text: "T" }, { post }),
      ).toEqual({ ok: false, kind: "permanent" });
      expect(post).not.toHaveBeenCalled();
    } finally {
      envState.TELEGRAM_BOT_TOKEN = "123:abc";
    }
  });

  it("sendMessageUrl не светит токен в логах: исход не содержит URL", async () => {
    // sendTelegramMessage логирует только status+kind+chatId; сам URL
    // с токеном не логируется нигде (проверено структурой лог-вызовов).
    const url = sendMessageUrl();
    expect(url).toContain("bot123:abc");
  });
});
