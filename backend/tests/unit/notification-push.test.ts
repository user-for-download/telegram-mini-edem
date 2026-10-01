// backend/tests/unit/notification-push.test.ts
//
// Проверяем outbox-wiring в createNotification (bot-api shadow mode):
// inbox-запись создаётся как раньше; для TG-пользователей после записи
// кладётся задача NotificationDelivery (pending) или skip с причиной.
// Решение — decideTelegramDelivery (политика с чатом/kill-switch),
// дедуп до записи, deep-link через allowlist.
//
// Item 7: notifyUser оборачивает createNotification + WS-hint
// (notification:new с NOTIFICATION_HINT_REFRESH_ID): hint уходит только
// когда запись реально создана, пропуски по тумблеру/дедупу ленту не дёргают.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_HINT_REFRESH_ID } from "@edem/contracts";

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

vi.mock("../../src/services/wsManager.js", () => ({
  wsManager: { sendToUser: vi.fn() },
}));

const envState = { TELEGRAM_DELIVERY_ENABLED: true };
vi.mock("../../src/env.js", () => ({ env: envState }));

const { createNotification, notifyUser } = await import(
  "../../src/services/notification.service.js"
);

const { wsManager } = await import("../../src/services/wsManager.js");
const sendToUser = vi.mocked(wsManager.sendToUser);

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

  it("actor/action пишутся в inbox, но не утекают в outbox", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await createNotification(
      "u1",
      "booking_status_changed",
      "T",
      "B",
      "/trips/trip-1",
      "Илья Северов",
      "confirmed",
    );

    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        type: "booking_status_changed",
        title: "T",
        body: "B",
        deepLink: "/notifications",
        actorName: "Илья Северов",
        action: "confirmed",
        tripFrom: null,
        tripTo: null,
        tripPrice: null,
        tripDepartureAt: null,
      },
    });
    const delivery = deliveryCreate.mock.calls[0][0].data;
    expect(delivery).not.toHaveProperty("actorName");
    expect(delivery).not.toHaveProperty("action");
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

  it("m10: пропуск по тумблеру возвращает null (WS-hint гасится)", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: false,
      tgChatJoinedAt: new Date(),
    });

    await expect(
      createNotification("u1", "booking_created", "T", "B"),
    ).resolves.toBeNull();
  });

  it("m10: созданная запись возвращает id", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await expect(
      createNotification("u1", "trip_cancelled", "T", "B"),
    ).resolves.toBe("n1");
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

  it("m9: дедуп работает и без telegramUserId (не только TG)", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: null,
      notificationsEnabled: true,
    });
    notificationFindFirst.mockResolvedValue({ id: "existing" });

    await expect(
      createNotification("u1", "trip_cancelled", "T", "B"),
    ).resolves.toBeNull();

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("m10: дубликат возвращает null", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });
    notificationFindFirst.mockResolvedValue({ id: "existing" });

    await expect(
      createNotification("u1", "trip_cancelled", "T", "B"),
    ).resolves.toBeNull();

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
    ).resolves.toBe("n1");

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

describe("notifyUser — WS hint wiring (item 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCreate.mockResolvedValue({ id: "n1" });
    notificationFindFirst.mockResolvedValue(null);
    envState.TELEGRAM_DELIVERY_ENABLED = true;
  });

  it("hint id — контрактный сентинел 'refresh' (без магии на колл-сайтах)", () => {
    expect(NOTIFICATION_HINT_REFRESH_ID).toBe("refresh");
  });

  it("созданная запись → hint отправлен, возвращается id", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });

    await expect(
      notifyUser({ userId: "u1", type: "trip_cancelled", title: "T", body: "B" }),
    ).resolves.toBe("n1");

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith("u1", {
      type: "notification:new",
      payload: { id: NOTIFICATION_HINT_REFRESH_ID },
    });
  });

  it("пропуск по тумблеру (null id) → hint НЕ отправлен", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: false,
      tgChatJoinedAt: new Date(),
    });

    await expect(
      notifyUser({ userId: "u1", type: "booking_created", title: "T", body: "B" }),
    ).resolves.toBeNull();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("дедуп-пропуск (null id) → hint НЕ отправлен", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      telegramUserId: 123n,
      notificationsEnabled: true,
      tgChatJoinedAt: new Date(),
    });
    notificationFindFirst.mockResolvedValue({ id: "existing" });

    await expect(
      notifyUser({ userId: "u1", type: "trip_cancelled", title: "T", body: "B" }),
    ).resolves.toBeNull();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });
});
