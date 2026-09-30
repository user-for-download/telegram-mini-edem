// backend/tests/integration/server-errors.test.ts
//
// 4xx через полный app не будят репортёр: onError срабатывает только
// на необработанных 500. 404 → тишина в Telegram-канале.
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

const { app } = await import("../../src/app.js");

describe("server errors wiring", () => {
  it("404 → без алертов", async () => {
    const res = await app.request("/api/v1/no-such-route");
    expect(res.status).toBe(404);
    await Promise.resolve();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
