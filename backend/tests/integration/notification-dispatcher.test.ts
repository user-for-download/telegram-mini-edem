// backend/tests/integration/notification-dispatcher.test.ts
//
// Интеграционный прогон outbox-диспетчера на реальной БД (без токена:
// no_token): createNotification кладёт задачу → pollOnce размечает.
// Проверяем сквозные переходы статусов, rate limit по delivered-строкам,
// немедленный отзыв согласия и no_token-путь (внешних вызовов нет).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db } = await import("../../src/db.js");
const { env } = await import("../../src/env.js");
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
  // Без токена: следим, что никаких внешних вызовов не происходит.
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

describe("pollOnce — сквозной outbox (no_token)", () => {
  it("событие → outbox pending → pollOnce → skipped/no_token", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T", "B", "/bookings");

    let deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("pending");

    const claimed = await pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(1);

    deliveries = await deliveriesOf(userId);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("no_token");
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

    // Первый: без токена ушёл бы в skipped — имитируем реальную доставку,
    // чтобы cooldown-окно было активно (лимит считается по delivered).
    await createNotification(userId, "trip_cancelled", "T1", "B1", "/trips");
    await pollOnce();
    expect((await deliveriesOf(userId))[0].status).toBe("skipped");
    await db.notificationDelivery.updateMany({
      where: { userId },
      data: { status: "delivered", error: null },
    });

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
    // Явно ждём: второй poll не должен трогать skipped-задачу.
    await pollOnce();

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    // updatedAt не менялся бы при повторном claim; проверяем статус.
    expect(deliveries[0].status).toBe("skipped");
  });
});

describe("pollOnce — восстановление зависших processing (рестарт)", () => {
  /** Момент заведомо за таймаутом recovery (дефолт 10 мин + запас). */
  function pastTimeout(): Date {
    return new Date(Date.now() + env.TG_NOTIFICATION_PROCESSING_TIMEOUT_MS + 60_000);
  }

  it("stuck processing старше таймаута → recovered и skipped в том же тике", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T-stuck", "B-stuck");
    const stuckId = (await deliveriesOf(userId))[0].id;
    // Имитация краха: задача захвачена, но не размечена.
    await db.notificationDelivery.update({
      where: { id: stuckId },
      data: { status: "processing" },
    });

    const claimed = await pollOnce({ now: () => pastTimeout() });
    expect(claimed).toBe(1);

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("no_token");
    // Recovery засчитал одну попытку; settle skipped не bump'ит.
    expect(deliveries[0].attempts).toBe(1);
  });

  it("свежая processing (внутри таймаута) не трогается", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T-fresh", "B-fresh");
    const freshId = (await deliveriesOf(userId))[0].id;
    await db.notificationDelivery.update({
      where: { id: freshId },
      data: { status: "processing" },
    });

    expect(await pollOnce()).toBe(0);

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("processing");
    expect(deliveries[0].attempts).toBe(0);
  });

  it("stuck на исходе ретраев (attempts+1 >= MAX) → failed", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(userId, "trip_cancelled", "T-limit", "B-limit");
    const stuckId = (await deliveriesOf(userId))[0].id;
    await db.notificationDelivery.update({
      where: { id: stuckId },
      data: {
        status: "processing",
        attempts: env.TG_NOTIFICATION_MAX_RETRIES - 1,
      },
    });

    expect(await pollOnce({ now: () => pastTimeout() })).toBe(0);

    const deliveries = await deliveriesOf(userId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].error).toBe("max_retries_exceeded");
    expect(deliveries[0].attempts).toBe(env.TG_NOTIFICATION_MAX_RETRIES);
  });
});
