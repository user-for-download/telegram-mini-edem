// backend/tests/integration/server-errors.test.ts
//
// 4xx через полный app не будят репортёр: onError срабатывает только
// на необработанных 500. 404 → тишина в Telegram-канале.
//
// Путь server-error публичным эндпоинтом не проверить (kind "server"
// там отклоняется — и это правильно), поэтому настоящий onError-хендлер
// (handleUnhandledError из app.ts) прогоняется через пробный Hono
// с бросающим роутом: 500 → server-error с именем и маршрутом,
// без текста исключения.
import { Hono } from "hono";
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

const { app, handleUnhandledError } = await import("../../src/app.js");

describe("server errors wiring", () => {
  it("404 → без алертов", async () => {
    const res = await app.request("/api/v1/no-such-route");
    expect(res.status).toBe(404);
    await Promise.resolve();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("throw в роуте → 500 и server-error без текста исключения", async () => {
    const probe = new Hono();
    probe.onError(handleUnhandledError);
    probe.get("/boom", () => {
      throw new Error("secret db exploded, token abc123");
    });

    const res = await probe.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const input = sendTelegramMessage.mock.calls[0][0] as {
      chatId: number;
      text: string;
    };
    expect(input.chatId).toBe(-100999);
    expect(input.text).toContain("server-error");
    expect(input.text).toContain("Error");
    expect(input.text).toContain("GET /boom");
    expect(input.text).not.toContain("secret db exploded");
    expect(input.text).not.toContain("abc123");
  });
});
