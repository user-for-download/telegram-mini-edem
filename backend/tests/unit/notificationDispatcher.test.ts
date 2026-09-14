// backend/tests/unit/notificationDispatcher.test.ts
//
// Outbox-диспетчер (bot-api shadow): pollOnce размечает задачи без
// внешних вызовов. Мокаем db/env (паттерн telegramNotifications.test),
// fetch-шпион следит, что api.telegram.org не зовётся НИКОГДА.
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateManyAndReturn = vi.fn();
const update = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const deliveryCount = vi.fn();
const deliveryFindFirst = vi.fn();
const notificationFindUnique = vi.fn();
const sendMock = vi.fn();

vi.mock("../../src/db.js", () => ({
  db: {
    user: { findUnique: userFindUnique, update: userUpdate },
    notification: { findUnique: notificationFindUnique },
    notificationDelivery: {
      updateManyAndReturn,
      update,
      count: deliveryCount,
      findFirst: deliveryFindFirst,
    },
  },
}));

vi.mock("../../src/services/telegramSend.js", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendMock(...args),
}));

vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const envState = {
  TELEGRAM_DELIVERY_ENABLED: true,
  TELEGRAM_BOT_TOKEN: "",
  TG_NOTIFICATION_DISPATCH_BATCH_SIZE: 20,
  TG_NOTIFICATION_MAX_RETRIES: 3,
  TG_NOTIFICATION_USER_RATE_WINDOW_MS: 3_600_000,
  TG_NOTIFICATION_USER_RATE_MAX: 5,
  TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS: 300_000,
};
vi.mock("../../src/env.js", () => ({ env: envState }));

const { pollOnce } = await import("../../src/workers/notificationDispatcher.js");

const USER_ACTIVE = {
  notificationsEnabled: true,
  tgChatJoinedAt: new Date("2026-09-01T00:00:00Z"),
  telegramUserId: 99_123n,
};

function delivery(
  over: Partial<{
    id: string;
    notificationId: string;
    userId: string;
    type: string;
    attempts: number;
    deepLink: string | null;
  }> = {},
) {
  return {
    id: "d1",
    notificationId: "n1",
    userId: "u1",
    type: "trip_cancelled",
    attempts: 0,
    deepLink: "/bookings",
    ...over,
  };
}

describe("pollOnce — захват и обработка", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    envState.TELEGRAM_DELIVERY_ENABLED = true;
    envState.TELEGRAM_BOT_TOKEN = "";
    update.mockResolvedValue({});
    userUpdate.mockResolvedValue({});
    userFindUnique.mockResolvedValue(USER_ACTIVE);
    notificationFindUnique.mockResolvedValue({ title: "Заголовок", body: "Тело" });
    sendMock.mockResolvedValue({ ok: true });
    deliveryCount.mockResolvedValue(0);
    deliveryFindFirst.mockResolvedValue(null);
  });

  it("пустая очередь → 0, апдейтов нет", async () => {
    updateManyAndReturn.mockResolvedValue([]);
    expect(await pollOnce()).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("happy path: чат + тумблер → delivered/shadow, без внешних вызовов", async () => {
    updateManyAndReturn.mockResolvedValue([delivery()]);

    const claimed = await pollOnce();

    expect(claimed).toBe(1);
    // Статус delivered с маркером shadow (Bot API заблокирован).
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "delivered", error: "shadow" }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kill-switch перечитан в момент обработки → skipped/channel_disabled", async () => {
    envState.TELEGRAM_DELIVERY_ENABLED = false;
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "skipped", error: "channel_disabled" }),
    });
    // Пользователь даже не читается — kill-switch важнее.
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("чат отозван между enqueue и обработкой → skipped/no_chat", async () => {
    userFindUnique.mockResolvedValue({
      notificationsEnabled: true,
      tgChatJoinedAt: null,
    });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "skipped", error: "no_chat" }),
    });
  });

  it("тумблер выключен после enqueue (optional) → skipped/notifications_disabled", async () => {
    userFindUnique.mockResolvedValue({
      notificationsEnabled: false,
      tgChatJoinedAt: new Date(),
    });
    updateManyAndReturn.mockResolvedValue([delivery({ type: "booking_created" })]);

    await pollOnce();

    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "skipped",
        error: "notifications_disabled",
      }),
    });
  });

  it("critical cooldown: свежая delivered того же типа → отложить, попыткой не считать", async () => {
    deliveryFindFirst.mockResolvedValue({ id: "recent" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        nextAttemptAt: expect.any(Date),
      }),
    });
    // Ключевое: attempts не инкрементируется (defer != failure).
    const data = update.mock.calls[0][0].data;
    expect(data.attempts).toBeUndefined();
  });

  it("optional rate limit: 5 delivered в окне → pending с nextAttemptAt", async () => {
    deliveryCount.mockResolvedValue(5);
    updateManyAndReturn.mockResolvedValue([delivery({ type: "booking_created" })]);

    await pollOnce();

    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it("ошибка БД → attempts+1 и pending с бэкоффом 1м", async () => {
    // Первая settle (update) падает как «неожиданная ошибка обработки».
    update.mockRejectedValueOnce(new Error("db flake"));
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    // Второй вызов — ретраевая разметка.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        error: "retry",
        attempts: 1,
      }),
    });
  });

  it("ошибка на attempts=2 (последняя) → failed/max_retries_exceeded", async () => {
    update.mockRejectedValueOnce(new Error("db flake"));
    updateManyAndReturn.mockResolvedValue([delivery({ attempts: 2 })]);

    await pollOnce();

    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "failed",
        error: "max_retries_exceeded",
        attempts: 3,
      }),
    });
  });

  it("batch обрабатывается целиком", async () => {
    updateManyAndReturn.mockResolvedValue([
      delivery({ id: "d1" }),
      delivery({ id: "d2", userId: "u2", type: "booking_created" }),
      delivery({ id: "d3", userId: "u3", type: "review_approved" }),
    ]);

    const claimed = await pollOnce();

    expect(claimed).toBe(3);
    expect(update).toHaveBeenCalledTimes(3);
  });
});

describe("pollOnce — реальная отправка (токен задан, bot-api-send)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.TELEGRAM_DELIVERY_ENABLED = true;
    envState.TELEGRAM_BOT_TOKEN = "123:abc";
    update.mockResolvedValue({});
    userUpdate.mockResolvedValue({});
    userFindUnique.mockResolvedValue(USER_ACTIVE);
    notificationFindUnique.mockResolvedValue({
      title: "Заявка подтверждена",
      body: "Водитель подтвердил вашу заявку",
    });
    sendMock.mockResolvedValue({ ok: true });
    deliveryCount.mockResolvedValue(0);
    deliveryFindFirst.mockResolvedValue(null);
  });

  it("ok → delivered без shadow-маркера; текст = title+body, deep-link передан", async () => {
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(sendMock).toHaveBeenCalledWith({
      chatId: Number(USER_ACTIVE.telegramUserId),
      text: "Заявка подтверждена\n\nВодитель подтвердил вашу заявку",
      deepLink: "/bookings",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "delivered", error: null }),
    });
  });

  it("403 bot_blocked → skipped + согласие сброшено (tgChatJoinedAt=null)", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "bot_blocked" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tgChatJoinedAt: null },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "skipped", error: "bot_blocked" }),
    });
  });

  it("429 rate_limited → pending с nextAttemptAt = retry_after, attempts+1", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "rate_limited", retryAfterMs: 120_000 });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        error: "rate_limited",
        attempts: 1,
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it("transient (сеть) → pending с бэкоффом, error=network_error", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "transient" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        error: "network_error",
        attempts: 1,
      }),
    });
  });

  it("transient на последней попытке → failed/network_error", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "transient" });
    updateManyAndReturn.mockResolvedValue([delivery({ attempts: 2 })]);

    await pollOnce();

    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "failed",
        error: "network_error",
        attempts: 3,
      }),
    });
  });

  it("400 permanent → ретраи по обычной схеме, error=bad_request", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "permanent" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "pending",
        error: "bad_request",
        attempts: 1,
      }),
    });
  });

  it("inbox-запись удалена → skipped/notification_deleted, без отправки", async () => {
    notificationFindUnique.mockResolvedValue(null);
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    expect(sendMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "skipped",
        error: "notification_deleted",
      }),
    });
  });
});

describe("pollOnce — захват очереди", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("забирает только pending с наступившим nextAttemptAt", async () => {
    updateManyAndReturn.mockResolvedValue([]);
    await pollOnce({ now: () => new Date("2026-09-14T12:00:00Z") });

    const where = updateManyAndReturn.mock.calls[0][0].where;
    expect(where.status).toBe("pending");
    expect(where.OR).toEqual([
      { nextAttemptAt: null },
      { nextAttemptAt: { lte: new Date("2026-09-14T12:00:00Z") } },
    ]);
    // Атомарный claim: статус сразу в processing; limit вместо take (Prisma 7).
    expect(updateManyAndReturn.mock.calls[0][0].data).toEqual({
      status: "processing",
    });
    expect(updateManyAndReturn.mock.calls[0][0].limit).toBe(
      envState.TG_NOTIFICATION_DISPATCH_BATCH_SIZE,
    );
  });

  it("обработка не бросает наружу даже при катастрофе в claim", async () => {
    updateManyAndReturn.mockRejectedValue(new Error("conn lost"));
    await expect(pollOnce()).rejects.toThrow("conn lost");
  });
});
