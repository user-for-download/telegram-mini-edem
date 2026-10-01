// backend/tests/unit/notificationDispatcher.test.ts
//
// Outbox-диспетчер (no_token без токена): pollOnce размечает задачи;
// без токена внешнего вызова нет, с токеном — реальный sendMock.
// Мокаем db/env (паттерн telegramNotifications.test),
// fetch-шпион следит, что api.telegram.org не зовётся НИКОГДА.
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateManyAndReturn = vi.fn();
const updateMany = vi.fn();
const findManyStuck = vi.fn();
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
      updateMany,
      findMany: findManyStuck,
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
  TG_NOTIFICATION_PROCESSING_TIMEOUT_MS: 600_000,
  TG_NOTIFICATION_USER_RATE_WINDOW_MS: 3_600_000,
  TG_NOTIFICATION_USER_RATE_MAX: 5,
  TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS: 300_000,
  TG_NOTIFICATION_DISPATCH_INTERVAL_MS: 5_000,
};
vi.mock("../../src/env.js", () => ({ env: envState }));

const { pollOnce, startNotificationDispatcher, stopNotificationDispatcher } =
  await import("../../src/workers/notificationDispatcher.js");
const { logger } = await import("../../src/logger.js");

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
    findManyStuck.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 0 });
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

  it("happy path без токена: чат + тумблер → skipped/no_token, без внешних вызовов", async () => {
    updateManyAndReturn.mockResolvedValue([delivery()]);

    const claimed = await pollOnce();

    expect(claimed).toBe(1);
    // Без токена внешнего вызова нет — задача тихо skipped.
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "skipped", error: "no_token" }),
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

  it("ошибка БД → attempts+1 и pending с бэкоффом 1м, err залогирован", async () => {
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
    // Bare catch логирует пойманную ошибку (ids + машинные коды, без PII).
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: "u1" }),
      expect.any(String),
    );
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
    findManyStuck.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 0 });
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

  it("ok → delivered без маркера; текст = title+body, deep-link передан", async () => {
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

  it("chat_not_found → skipped + согласие сброшено, ретраев нет (одна попытка)", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "chat_not_found" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    // Ровно одна попытка отправки — перепланирования нет.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tgChatJoinedAt: null },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "skipped", error: "chat_not_found" }),
    });
    // Терминально: ни pending-возврата, ни инкремента попыток.
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("skipped");
    expect(data.attempts).toBeUndefined();
    expect(data.nextAttemptAt ?? null).toBeNull();
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

  it("400 permanent → сразу failed/bad_request, одна попытка (ретраев нет)", async () => {
    sendMock.mockResolvedValue({ ok: false, kind: "permanent" });
    updateManyAndReturn.mockResolvedValue([delivery()]);

    await pollOnce();

    // Ровно одна попытка отправки — перепланирования нет.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        status: "failed",
        error: "bad_request",
        attempts: 1,
      }),
    });
    // Терминально: второго шанса нет (nextAttemptAt=null).
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("failed");
    expect(data.nextAttemptAt ?? null).toBeNull();
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
    findManyStuck.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 0 });
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

describe("pollOnce — восстановление зависших processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.TELEGRAM_DELIVERY_ENABLED = true;
    envState.TELEGRAM_BOT_TOKEN = "";
    envState.TG_NOTIFICATION_PROCESSING_TIMEOUT_MS = 600_000;
    envState.TG_NOTIFICATION_MAX_RETRIES = 3;
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue({});
    userFindUnique.mockResolvedValue(USER_ACTIVE);
    notificationFindUnique.mockResolvedValue({ title: "Заголовок", body: "Тело" });
    deliveryCount.mockResolvedValue(0);
    deliveryFindFirst.mockResolvedValue(null);
  });

  it("stuck-строка старше таймаута → pending и отправлена ровно один раз", async () => {
    findManyStuck.mockResolvedValue([{ id: "stuck1", attempts: 0 }]);
    // Восстановленная строка забирается тем же тиком.
    updateManyAndReturn.mockResolvedValue([delivery({ id: "stuck1" })]);
    const now = new Date("2026-09-14T12:00:00Z");

    const claimed = await pollOnce({ now: () => now });

    // Фильтр: только processing старше cutoff (fresh не затрагиваем).
    expect(findManyStuck).toHaveBeenCalledWith({
      where: {
        status: "processing",
        updatedAt: {
          lt: new Date(now.getTime() - envState.TG_NOTIFICATION_PROCESSING_TIMEOUT_MS),
        },
      },
      select: { id: true, attempts: true },
    });
    // Возврат в очередь: claimable сразу (nextAttemptAt=null), attempts+1.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stuck1"] } },
      data: expect.objectContaining({
        status: "pending",
        nextAttemptAt: null,
        error: "processing_timeout",
      }),
    });
    expect(updateMany.mock.calls[0][0].data.attempts).toEqual({ increment: 1 });
    // Тот же тик доставил ровно один раз (no_token, без внешних вызовов).
    expect(claimed).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "stuck1" },
      data: expect.objectContaining({ status: "skipped", error: "no_token" }),
    });
  });

  it("свежие processing (внутри таймаута) не трогаются", async () => {
    // БД-фильтр updatedAt < cutoff свежие строки исключает сам —
    // зависших нет, recovery молчит, очередь пуста.
    findManyStuck.mockResolvedValue([]);
    updateManyAndReturn.mockResolvedValue([]);
    const now = new Date("2026-09-14T12:00:00Z");

    expect(await pollOnce({ now: () => now })).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("stuck на исходе ретраев (attempts+1 >= MAX) → failed", async () => {
    findManyStuck.mockResolvedValue([{ id: "stuck9", attempts: 2 }]);
    updateManyAndReturn.mockResolvedValue([]);

    await pollOnce();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stuck9"] } },
      data: expect.objectContaining({
        status: "failed",
        error: "max_retries_exceeded",
      }),
    });
    expect(updateMany.mock.calls[0][0].data.attempts).toEqual({ increment: 1 });
    // В очередь не возвращаем — claim нечего забирать, settle нет.
    expect(update).not.toHaveBeenCalled();
  });

  it("смешанный батч: retry-строки в pending, лимитные — в failed", async () => {
    findManyStuck.mockResolvedValue([
      { id: "s-retry", attempts: 0 },
      { id: "s-fail", attempts: 5 },
    ]);
    updateManyAndReturn.mockResolvedValue([]);

    await pollOnce();

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-retry"] } },
      data: expect.objectContaining({ status: "pending" }),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-fail"] } },
      data: expect.objectContaining({ status: "failed" }),
    });
  });
});

describe("startNotificationDispatcher — стартовая диагностика", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.TELEGRAM_DELIVERY_ENABLED = true;
    envState.TELEGRAM_BOT_TOKEN = "";
    findManyStuck.mockResolvedValue([]);
    updateManyAndReturn.mockResolvedValue([]);
  });

  it("enabled без токена → warn no_token, стартовый лог без «shadow»", async () => {
    startNotificationDispatcher();
    try {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "no_token" }),
        expect.any(String),
      );
      const infoText = vi
        .mocked(logger.info)
        .mock.calls.map((call) => String(call[0]))
        .join(" ");
      expect(infoText).not.toContain("shadow");
      expect(infoText).toContain("no_token");
    } finally {
      stopNotificationDispatcher();
    }
  });

  it("токен задан → warn нет", async () => {
    envState.TELEGRAM_BOT_TOKEN = "123:abc";
    startNotificationDispatcher();
    try {
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      stopNotificationDispatcher();
    }
  });
});
