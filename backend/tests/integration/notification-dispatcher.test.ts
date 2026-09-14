// backend/tests/integration/notification-dispatcher.test.ts
//
// Интеграционный прогон outbox-диспетчера на реальной БД (bot-api
// shadow): createNotification кладёт задачу → pollOnce размечает.
// Проверяем сквозные переходы статусов, rate limit по delivered-строкам,
// немедленный отзыв согласия и shadow-режим (внешних вызовов нет).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db } = await import("../../src/db.js");
const { createNotification } = await import(
  "../../src/services/notification.service.js"
);
const { pollOnce } = await import("../../src/workers/notificationDispatcher.js");

const createdUserIds: string[] = [];
let tgSeq = 9_940_000n;

async function seedUser(data: Record<string, unknown> = {}): Promise<string> {
  const user = await db.user.create({
    data: {
      telegramUserId: tgSeq++,
      name: "Dispatch",
      avatar: "",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function deliveriesOf(userId: string) {
  return db.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

beforeEach(() => {
  // Shadow: следим, что никаких внешних вызовов не происходит.
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("pollOnce — сквозной outbox (shadow)", () => {
  it("событие → outbox pending → pollOnce → delivered/shadow", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T", "B", "/bookings");

    let deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("pending");

    const claimed = await pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(1);

    deliveries = await deliveriesOf(userId);
    expect(deliveries[0].status).toBe("delivered");
    expect(deliveries[0].error).toBe("shadow");
    expect(deliveries[0].deepLink).toBe("/bookings");
  });

  it("отзыв /stop между enqueue и poll → skipped/no_chat", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T", "B");

    // Пользователь отзывает согласие до обработки.
    await db.user.update({
      where: { id: userId },
      data: { tgChatJoinedAt: null },
    });

    await pollOnce();

    const deliveries = await deliveriesOf(userId);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("no_chat");
  });

  it("второй критичный того же типа в cooldown-окне → deferred (pending)", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    // Первый: уйдёт в delivered.
    await createNotification(userId, "trip_cancelled", "T1", "B1", "/trips");
    await pollOnce();
    expect((await deliveriesOf(userId))[0].status).toBe("delivered");

    // Второй того же типа (другой текст — дедуп не мешает).
    await createNotification(userId, "trip_cancelled", "T2", "B2", "/trips");
    await pollOnce();

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1].status).toBe("pending");
    expect(deliveries[1].nextAttemptAt).not.toBeNull();
    // Defer не считается попыткой.
    expect(deliveries[1].attempts).toBe(0);
  });

  it("обработанная задача не забирается повторно", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T", "B");
    await pollOnce();
    // Явно ждём: второй poll не должен трогать delivered-задачу.
    await pollOnce();

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    // updatedAt не менялся бы при повторном claim; проверяем статус.
    expect(deliveries[0].status).toBe("delivered");
  });
});
