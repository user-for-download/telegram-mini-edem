import { afterEach, describe, expect, it } from "vitest";

const { db } = await import("../../src/db.js");
const { env } = await import("../../src/env.js");
const { createNotification, pruneOldNotifications } = await import(
  "../../src/services/notification.service.js"
);

/**
 * POST-транзакционная TG-доставка (tg-migration-15).
 *
 * Утверждённый механизм: inbox-запись + наблюдаемый исход, внешних
 * вызовов нет (Bot API заблокирован — TELEGRAM_BOT_TOKEN не требуется
 * и не используется). Проверяем сквозь createNotification:
 * opt-out, critical override, дедуп повторов (для всех, m9),
 * различимые события и путь без platform-id.
 *
 * Паттерны репо: реальная БД, уникальные telegramUserId (BigInt-диапазон
 * 9_930_000+), чистка созданных строк в afterEach.
 */
const createdUserIds: string[] = [];
let tgSeq = 9_930_000n;

function nextTgId(): bigint {
  tgSeq += 1n;
  return tgSeq;
}

async function seedTelegramUser(
  data: Record<string, unknown> = {},
): Promise<string> {
  const user = await db.user.create({
    data: {
      telegramUserId: nextTgId(),
      name: "TgNotif",
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedIdentitylessUser(
  data: Record<string, unknown> = {},
): Promise<string> {
  const user = await db.user.create({
    data: {
      name: "NoIdentity",
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function countNotifications(userId: string): Promise<number> {
  return db.notification.count({ where: { userId } });
}

async function countDeliveries(
  userId: string,
  status?: string,
): Promise<number> {
  return db.notificationDelivery.count({
    where: { userId, ...(status ? { status } : {}) },
  });
}

afterEach(async () => {
  // NotificationDelivery сцеплена с Notification FK Cascade — чистится
  // через удаление inbox-записей пользователей.
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("createNotification — TG-доставка", () => {
  it("optional при выключенном тумблере → записи нет", async () => {
    const userId = await seedTelegramUser({ notificationsEnabled: false });

    await createNotification(
      userId,
      "booking_created",
      "Новая заявка",
      "Пассажир хочет поехать с вами",
    );

    expect(await countNotifications(userId)).toBe(0);
  });

  it("critical при выключенном тумблере → запись создана", async () => {
    const userId = await seedTelegramUser({ notificationsEnabled: false });

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
  });

  it("идентичный повтор внутри окна → вторая запись не создаётся", async () => {
    const userId = await seedTelegramUser({});

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );
    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
  });

  it("различимые события (разный текст) → обе записи созданы", async () => {
    const userId = await seedTelegramUser({});

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );
    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Казань → Уфа отменена",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(2);
  });

  it("без Bot-токена и внешней конфигурации доставка не падает", async () => {
    // TELEGRAM_BOT_TOKEN в тестовом окружении не задан — утвержденному
    // механизму он не нужен: запись создаётся, исключений нет.
    // m10: возвращается id созданной записи.
    const userId = await seedTelegramUser({});

    const id = await createNotification(
      userId,
      "booking_status_changed",
      "Заявка подтверждена",
      "Водитель подтвердил вашу заявку",
      "/bookings",
    );
    expect(typeof id).toBe("string");

    expect(await countNotifications(userId)).toBe(1);
  });

  it("пользователь без platform-id: дедуп тоже работает (m9)", async () => {
    const userId = await seedIdentitylessUser({});

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );
    const second = await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    // Дедуп — для всех пользователей, не только TG: повтор не плодит
    // записи и возвращает null (WS-hint гасится).
    expect(second).toBeNull();
    expect(await countNotifications(userId)).toBe(1);
  });
});

describe("createNotification — outbox (bot-api shadow)", () => {
  it("чат есть + тумблер on → outbox pending привязан к inbox-записи", async () => {
    const userId = await seedTelegramUser({ tgChatJoinedAt: new Date() });

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
    expect(await countDeliveries(userId, "pending")).toBe(1);
    const delivery = await db.notificationDelivery.findFirst({
      where: { userId },
    });
    expect(delivery?.deepLink).toBe("/bookings");
    expect(delivery?.channel).toBe("telegram");
    // FK указывает на реальную inbox-запись.
    const notification = await db.notification.findFirst({ where: { userId } });
    expect(delivery?.notificationId).toBe(notification?.id);
  });

  it("чата нет → outbox skipped с причиной no_chat", async () => {
    const userId = await seedTelegramUser({ tgChatJoinedAt: null });

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Текст",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
    expect(await countDeliveries(userId, "skipped")).toBe(1);
    const delivery = await db.notificationDelivery.findFirst({
      where: { userId },
    });
    expect(delivery?.error).toBe("no_chat");
  });

  it("critical + выключенный тумблер + чат → inbox + outbox pending", async () => {
    const userId = await seedTelegramUser({
      notificationsEnabled: false,
      tgChatJoinedAt: new Date(),
    });

    await createNotification(
      userId,
      "booking_status_changed",
      "Заявка подтверждена",
      "Водитель подтвердил вашу заявку",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
    expect(await countDeliveries(userId, "pending")).toBe(1);
  });

  it("дубликат → вторая outbox-запись не создаётся", async () => {
    const userId = await seedTelegramUser({ tgChatJoinedAt: new Date() });

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );
    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    expect(await countDeliveries(userId)).toBe(1);
  });

  it("пользователь без platform-id → outbox не создаётся", async () => {
    const userId = await seedIdentitylessUser({});

    await createNotification(
      userId,
      "trip_cancelled",
      "Поездка отменена",
      "Текст",
      "/bookings",
    );

    expect(await countNotifications(userId)).toBe(1);
    expect(await countDeliveries(userId)).toBe(0);
  });
});

describe("pruneOldNotifications — retention", () => {
  const HOUR_MS = 60 * 60 * 1000;
  let inboxSeq = 0;

  async function seedInbox(
    userId: string,
    opts: { isRead: boolean; createdAt: Date },
  ): Promise<string> {
    inboxSeq += 1;
    const row = await db.notification.create({
      data: {
        userId,
        type: "trip_cancelled",
        title: `Retention ${inboxSeq}`,
        body: `Retention body ${inboxSeq}`,
        isRead: opts.isRead,
        createdAt: opts.createdAt,
      },
    });
    return row.id;
  }

  async function seedOutbox(
    notificationId: string,
    userId: string,
    status: string,
    updatedAt: Date,
  ): Promise<string> {
    const delivery = await db.notificationDelivery.create({
      data: {
        notificationId,
        userId,
        channel: "telegram",
        type: "trip_cancelled",
        status,
      },
    });
    // updatedAt — @updatedAt: Prisma не даёт выставить вручную,
    // поэтому сдвигаем в прошлое прямым SQL.
    await db.$executeRaw`UPDATE "NotificationDelivery" SET "updatedAt" = ${updatedAt} WHERE "id" = ${delivery.id}`;
    return delivery.id;
  }

  async function deliveryExists(id: string): Promise<boolean> {
    return (
      (await db.notificationDelivery.findUnique({ where: { id } })) !== null
    );
  }

  async function inboxExists(id: string): Promise<boolean> {
    return (await db.notification.findUnique({ where: { id } })) !== null;
  }

  it("outbox: старые terminal удалены, pending/processing целы, граница окна", async () => {
    const userId = await seedTelegramUser({});
    const parentId = await seedInbox(userId, {
      isRead: false,
      createdAt: new Date(),
    });
    const now = Date.now();
    const windowMs = env.TG_NOTIFICATION_OUTBOX_RETENTION_MS;
    const inside = new Date(now - windowMs + HOUR_MS);
    const outside = new Date(now - windowMs - HOUR_MS);

    const oldDelivered = await seedOutbox(parentId, userId, "delivered", outside);
    const freshDelivered = await seedOutbox(parentId, userId, "delivered", inside);
    const oldSkipped = await seedOutbox(parentId, userId, "skipped", outside);
    const oldFailed = await seedOutbox(parentId, userId, "failed", outside);
    // Незавершённые старые — чистка их не касается никогда.
    const oldPending = await seedOutbox(parentId, userId, "pending", outside);
    const oldProcessing = await seedOutbox(parentId, userId, "processing", outside);

    const result = await pruneOldNotifications();

    expect(result.outboxDeleted).toBe(3);
    expect(await deliveryExists(oldDelivered)).toBe(false);
    expect(await deliveryExists(oldSkipped)).toBe(false);
    expect(await deliveryExists(oldFailed)).toBe(false);
    expect(await deliveryExists(freshDelivered)).toBe(true);
    expect(await deliveryExists(oldPending)).toBe(true);
    expect(await deliveryExists(oldProcessing)).toBe(true);
  });

  it("inbox: границы read/unread окон (внутри — целы, снаружи — удалены)", async () => {
    const userId = await seedTelegramUser({});
    const now = Date.now();
    const readMs = env.TG_NOTIFICATION_INBOX_READ_RETENTION_MS;
    const unreadMs = env.TG_NOTIFICATION_INBOX_UNREAD_RETENTION_MS;

    const readInside = await seedInbox(userId, {
      isRead: true,
      createdAt: new Date(now - readMs + HOUR_MS),
    });
    const readOutside = await seedInbox(userId, {
      isRead: true,
      createdAt: new Date(now - readMs - HOUR_MS),
    });
    const unreadInside = await seedInbox(userId, {
      isRead: false,
      createdAt: new Date(now - unreadMs + HOUR_MS),
    });
    const unreadOutside = await seedInbox(userId, {
      isRead: false,
      createdAt: new Date(now - unreadMs - HOUR_MS),
    });

    const result = await pruneOldNotifications();

    expect(result.inboxReadDeleted).toBe(1);
    expect(result.inboxUnreadDeleted).toBe(1);
    expect(await inboxExists(readInside)).toBe(true);
    expect(await inboxExists(readOutside)).toBe(false);
    expect(await inboxExists(unreadInside)).toBe(true);
    expect(await inboxExists(unreadOutside)).toBe(false);
  });

  it("повторный прогон идемпотентен (второй раз удаляет 0)", async () => {
    const userId = await seedTelegramUser({});
    const parentId = await seedInbox(userId, {
      isRead: false,
      createdAt: new Date(),
    });
    await seedOutbox(
      parentId,
      userId,
      "failed",
      new Date(Date.now() - env.TG_NOTIFICATION_OUTBOX_RETENTION_MS - HOUR_MS),
    );
    await seedInbox(userId, {
      isRead: true,
      createdAt: new Date(
        Date.now() - env.TG_NOTIFICATION_INBOX_READ_RETENTION_MS - HOUR_MS,
      ),
    });

    const first = await pruneOldNotifications();
    expect(first.outboxDeleted).toBe(1);
    expect(first.inboxReadDeleted).toBe(1);

    const second = await pruneOldNotifications();
    expect(second).toEqual({
      outboxDeleted: 0,
      inboxReadDeleted: 0,
      inboxUnreadDeleted: 0,
    });
  });
});
