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

const { reportServerError, getClientErrorReporter } = await import(
  "../../src/client-errors/index.js"
);

describe("reportServerError", () => {
  it("5xx → алерт server-error: имя, route, кадры — без текста исключения", async () => {
    const error = new Error("db exploded, user mail@example.com");
    error.stack =
      "Error: db exploded, user mail@example.com\n    at handler (app.js:1:1)";
    reportServerError(error, "GET", "/api/v1/trips");
    await Promise.resolve();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const input = sendTelegramMessage.mock.calls[0][0] as {
      chatId: number;
      text: string;
    };
    expect(input.chatId).toBe(-100999);
    expect(input.text).toContain("server-error");
    expect(input.text).not.toContain("client-error");
    expect(input.text).toContain("GET /api/v1/trips");
    expect(input.text).toContain("Error");
    expect(input.text).not.toContain("db exploded");
    expect(input.text).not.toContain("mail@example.com");
  });

  it("флуд публичного инстанса не глушит серверный бюджет", async () => {
    sendTelegramMessage.mockClear();
    // Дефолтный потолок — 20/час: 25 уникальных клиентских → 20 алертов.
    for (let i = 0; i < 25; i++) {
      getClientErrorReporter().report({ kind: "error", message: `флуд ${i}` });
    }
    await Promise.resolve();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(20);

    // Серверный инстанс независим: «db connection lost» доходит 21-й.
    reportServerError(new Error("db connection lost"), "GET", "/health");
    await Promise.resolve();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(21);
    const input = sendTelegramMessage.mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(input.text).toContain("server-error");
  });

  it("разные Zod-дрейфы — разные алерты, индексы массивов схлопываются", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      price: z.number(),
      items: z.array(z.object({ id: z.string() })),
    });
    const driftPrice = schema.safeParse({ price: "x", items: [] });
    const driftId = schema.safeParse({ price: 1, items: [{ id: 5 }] });
    const driftIdOtherIndex = schema.safeParse({
      price: 1,
      items: [{ id: "ok" }, { id: 6 }],
    });
    expect(driftPrice.success).toBe(false);
    expect(driftId.success).toBe(false);
    expect(driftIdOtherIndex.success).toBe(false);
    if (driftPrice.success || driftId.success || driftIdOtherIndex.success) {
      return;
    }

    sendTelegramMessage.mockClear();
    reportServerError(driftPrice.error, "GET", "/api/v1/trips");
    reportServerError(driftId.error, "GET", "/api/v1/trips");
    // Тот же дрейф, другой индекс элемента — дедуплицируется.
    reportServerError(driftIdOtherIndex.error, "GET", "/api/v1/trips");
    await Promise.resolve();

    const texts = sendTelegramMessage.mock.calls.map(
      (call) => (call[0] as { text: string }).text,
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("ZodError: price(invalid_type)");
    expect(texts[1]).toContain("ZodError: items.*.id(invalid_type)");
  });

  it("пустое имя → заглушка, не бросает при сбое транспорта", async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error("net down"));
    const nameless = new Error();
    nameless.name = "";
    expect(() =>
      reportServerError(nameless, "POST", "/api/v1/bookings"),
    ).not.toThrow();
    await Promise.resolve();
    const input = sendTelegramMessage.mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(input.text).toContain("Error");
  });
});
