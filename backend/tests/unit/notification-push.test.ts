// backend/tests/unit/notification-push.test.ts
//
// Проверяем outbox-wiring в createNotification (bot-api shadow mode):
// inbox-запись создаётся как раньше; для TG-пользователей после записи
// кладётся задача NotificationDelivery (pending) или skip с причиной.
// Решение — decideTelegramDelivery (политика с чатом/kill-switch),
// дедуп до записи, deep-link через allowlist.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const notificationCreate = vi.fn().mockResolvedValue({ id: "n1" });
const notificationFindFirst = vi.fn().mockResolvedValue(null);
const deliveryCreate = vi.fn().mockResolvedValue({});

vi.mock("../../src/db.js", () => ({
  db: {
    user: { findUnique },
    notification: {
      create: notificationCreate,
      findFirst: notificationFindFirst,
    },
    notificationDelivery: { create: deliveryCreate },
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { error: vi.fn(), debug: vi.fn() },
}));

const envState = { TELEGRAM_DELIVERY_ENABLED: true };
vi.mock("../../src/env.js", () => ({ env: envState }));

const { createNotification } = await import(
  "../../src/services/notification.service.js"
);

describe("createNotification — outbox wiring (shadow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCreate.mockResolvedValue({ id: "n1" });
    notificationFindFirst.mockResolvedValue(null);
    envState.TELEGRAM_DELIVERY_ENABLED = true;
  });

  it("critical + чат → inbox + outbox pending с allowlist deep-link", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await createNotification("u1", "trip_cancelled", "T", "B", "/bookings");

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledWith({
      data: {
        notificationId: "n1",
        userId: "u1",
        channel: "telegram",
        type: "trip_cancelled",
        status: "pending",
        deepLink: "/bookings",
      },
    });
  });

  it("optional + тумблер on + чат → inbox + outbox pending", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await createNotification("u1", "booking_created", "T", "B");

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledTimes(1);
    const data = deliveryCreate.mock.calls[0][0].data;
    expect(data.status).toBe("pending");
    expect(data.deepLink).toBe("/notifications");
  });

  it("нет чата с ботом → inbox + outbox skipped/no_chat", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: null,
    });

    await createNotification("u1", "trip_cancelled", "T", "B");

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledTimes(1);
    const data = deliveryCreate.mock.calls[0][0].data;
    expect(data.status).toBe("skipped");
    expect(data.error).toBe("no_chat");
  });

  it("optional + выключенный тумблер → ни inbox, ни outbox", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: false,
      tgChatJoinedAt: new Date(),
    });

    await createNotification("u1", "booking_created", "T", "B");

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it("kill-switch → inbox + outbox skipped/channel_disabled", async () => {
    envState.TELEGRAM_DELIVERY_ENABLED = false;
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await createNotification("u1", "trip_cancelled", "T", "B");

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = deliveryCreate.mock.calls[0][0].data;
    expect(data.status).toBe("skipped");
    expect(data.error).toBe("channel_disabled");
  });

  it("дубликат → ни inbox, ни outbox", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });
    notificationFindFirst.mockResolvedValue({ id: "existing" });

    await createNotification("u1", "trip_cancelled", "T", "B");

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it("без telegramUserId → только inbox, без outbox", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: null,
      notificationsEnabled: true,
    });

    await createNotification("u1", "trip_cancelled", "T", "B");

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it("ошибка enqueue не откатывает inbox (isolation)", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });
    deliveryCreate.mockRejectedValue(new Error("outbox down"));

    await expect(
      createNotification("u1", "trip_cancelled", "T", "B"),
    ).resolves.toBeUndefined();

    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("подозрительный deep-link схлопывается в /notifications", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await createNotification("u1", "trip_cancelled", "T", "B", "/admin?x=1");

    const data = deliveryCreate.mock.calls[0][0].data;
    expect(data.deepLink).toBe("/notifications");
  });
});
