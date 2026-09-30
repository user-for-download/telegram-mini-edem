// backend/tests/unit/serverError.test.ts
//
// reportServerError (app.onError → тот же Telegram-канал):
// 5xx уходит с kind=server и route "METHOD path", пустое message
// заменяется, сбой транспорта наружу не просачивается.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ERROR_ALERT_CHAT_ID = "-100999";
});

vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const sendTelegramMessage = vi.fn(async () => ({ ok: true }));

vi.mock("../../src/services/telegramSend.js", () => ({
  sendTelegramMessage,
}));

const { reportServerError } = await import("../../src/client-errors/index.js");

describe("reportServerError", () => {
  it("5xx → алерт kind=server с route", async () => {
    const error = new Error("db exploded");
    error.stack = "Error: db exploded\n    at handler (app.js:1:1)";
    reportServerError(error, "GET", "/api/v1/trips");
    await Promise.resolve();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const input = sendTelegramMessage.mock.calls[0][0] as {
      chatId: number;
      text: string;
    };
    expect(input.chatId).toBe(-100999);
    expect(input.text).toContain("[server]");
    expect(input.text).toContain("GET /api/v1/trips");
    expect(input.text).toContain("db exploded");
  });

  it("пустое message → заглушка, не бросает при сбое транспорта", async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error("net down"));
    expect(() =>
      reportServerError(new Error(), "POST", "/api/v1/bookings"),
    ).not.toThrow();
    await Promise.resolve();
    const input = sendTelegramMessage.mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(input.text).toContain("Internal error");
  });
});
