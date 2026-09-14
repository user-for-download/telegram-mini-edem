import { afterEach, describe, expect, it } from "vitest";

const { db } = await import("../../src/db.js");
const { createNotification } = await import(
  "../../src/services/notification.service.js"
);

/**
 * POST-транзакционная TG-доставка (tg-migration-15).
 *
 * Утверждённый механизм: inbox-запись + наблюдаемый исход, внешних
 * вызовов нет (Bot API заблокирован — TELEGRAM_BOT_TOKEN не требуется
 * и не используется). Проверяем сквозь createNotification:
 * opt-out, critical override, дедуп повторов, различимые события
 * и путь без platform-id (без TG-дедупа).
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
    const userId = await seedTelegramUser({});

    await expect(
      createNotification(
        userId,
        "booking_status_changed",
        "Заявка подтверждена",
        "Водитель подтвердил вашу заявку",
        "/bookings",
      ),
    ).resolves.toBeUndefined();

    expect(await countNotifications(userId)).toBe(1);
  });

  it("пользователь без platform-id: critical создаёт записи без TG-дедупа", async () => {
    const userId = await seedIdentitylessUser({});

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

    // Дедуп применяется только к TG-идентифицированным пользователям.
    expect(await countNotifications(userId)).toBe(2);
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
