// backend/tests/e2e/botApiShadow.test.ts
//
// E2E bot-api shadow mode: полный жизненный цикл фоновых доставок без
// единого внешнего вызова (Bot API заблокирован ADR).
//
// Сценарий (approval-package §4.7 + §5 раскатка-шаг 1 «тень»):
// 1. /start через webhook → согласие зафиксировано;
// 2. critical (booking_status_changed) и optional (booking_created)
//    события → inbox + outbox pending;
// 3. pollOnce → delivered/shadow (fetch-шпион: api.telegram.org не звался);
// 4. /stop → optional даёт skipped/no_chat, critical без чата — тоже
//    тихо skipped (инвариант одного тумблера: критичные гейтятся только
//    чатом, сплита telegramNotificationsEnabled нет);
// 5. kill-switch → новые события дают skipped/channel_disabled;
// 6. метрики отражают агрегаты.
//
// Данные изолированы уникальными tgId (9_960_000+), fetch заглушён
// глобально: любые внешние вызовы валят тест.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "e2e-webhook-secret-123";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { createNotification } = await import(
  "../../src/services/notification.service.js"
);
const { pollOnce } = await import(
  "../../src/workers/notificationDispatcher.js"
);
const { getTelegramDeliveryMetrics } = await import(
  "../../src/services/telegramMetrics.js"
);
const { env } = await import("../../src/env.js");

const SECRET = "e2e-webhook-secret-123";
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_960_000n;
let fetchSpy: ReturnType<typeof vi.fn>;

interface TelegramUser {
  id: string;
  tgId: bigint;
}

async function seedUser(data: Record<string, unknown> = {}): Promise<TelegramUser> {
  const tgId = tgSeq++;
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `E2E ${tgId}`,
      avatar: "",
      // Согласие ставится вебхуком /start в тесте — по умолчанию чата нет.
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

async function webhookStart(tgId: bigint): Promise<Response> {
  return app.request(`/bot/webhook/${SECRET}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      message: {
        from: { id: Number(tgId) },
        chat: { id: Number(tgId) },
        text: "/start",
      },
    }),
  });
}

async function webhookStop(tgId: bigint): Promise<Response> {
  return app.request(`/bot/webhook/${SECRET}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      message: {
        from: { id: Number(tgId) },
        chat: { id: Number(tgId) },
        text: "/stop",
      },
    }),
  });
}

async function deliveriesOf(userId: string) {
  return db.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

async function inboxOf(userId: string) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

function assertNoExternalCalls(): void {
  const urls = fetchSpy.mock.calls
    .map((call) => String(call[0]))
    .filter((u) => u.includes("api.telegram.org") || u.includes("t.me"));
  expect(urls, `Внешние вызовы Telegram: ${urls.join(", ")}`).toEqual([]);
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  env.TELEGRAM_DELIVERY_ENABLED = true;
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("E2E: bot-api shadow — полный цикл", () => {
  it("/start → critical+optional события → outbox → pollOnce → delivered/shadow", async () => {
    const user = await seedUser();
    await webhookStart(user.tgId);

    // Согласие зафиксировано вебхуком.
    const consent = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(consent.tgChatJoinedAt).not.toBeNull();

    // Critical: тумблер выключен, но чат есть → inbox + outbox pending.
    await createNotification(
      user.id,
      "booking_status_changed",
      "Заявка подтверждена",
      "Водитель подтвердил вашу заявку",
      "/bookings",
    );
    // Optional: тумблер включён → inbox + outbox pending.
    await createNotification(
      user.id,
      "booking_created",
      "Новая заявка",
      "Пассажир хочет поехать",
      `/trips/my/${"123e4567-e89b-12d3-a456-426614174000"}/requests`,
    );

    const inbox = await inboxOf(user.id);
    expect(inbox).toHaveLength(2);

    let deliveries = await deliveriesOf(user.id);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "pending")).toBe(true);
    expect(deliveries[0].deepLink).toBe("/bookings");
    expect(deliveries[1].deepLink).toBe(
      "/trips/my/123e4567-e89b-12d3-a456-426614174000/requests",
    );

    // Диспетчер: обе задачи размечены delivered/shadow.
    const claimed = await pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(2);

    deliveries = await deliveriesOf(user.id);
    expect(deliveries.every((d) => d.status === "delivered")).toBe(true);
    expect(deliveries.every((d) => d.error === "shadow")).toBe(true);

    assertNoExternalCalls();
  });

  it("/stop → optional skipped/no_chat, critical без чата тоже тихо", async () => {
    const user = await seedUser({ tgChatJoinedAt: new Date() });
    await webhookStop(user.tgId);

    const consent = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(consent.tgChatJoinedAt).toBeNull();

    await createNotification(user.id, "booking_created", "T", "B");
    await createNotification(user.id, "trip_cancelled", "T", "B");

    // Inbox: critical создан, optional — тоже (тумблер on), но доставка
    // обеих записей в боте невозможна без чата.
    const inbox = await inboxOf(user.id);
    expect(inbox).toHaveLength(2);

    const deliveries = await deliveriesOf(user.id);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "skipped")).toBe(true);
    expect(deliveries.every((d) => d.error === "no_chat")).toBe(true);

    assertNoExternalCalls();
  });

  it("kill-switch → новые события skipped/channel_disabled, метрики это видят", async () => {
    const user = await seedUser({ tgChatJoinedAt: new Date() });
    env.TELEGRAM_DELIVERY_ENABLED = false;

    await createNotification(user.id, "trip_cancelled", "T", "B");

    const inbox = await inboxOf(user.id);
    expect(inbox).toHaveLength(1);

    const deliveries = await deliveriesOf(user.id);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("channel_disabled");

    // Метрики: канал выключен, skip по причине зафиксирован.
    const metrics = await getTelegramDeliveryMetrics();
    expect(metrics.channelEnabled).toBe(false);
    expect(metrics.skipped.channel_disabled).toBeGreaterThanOrEqual(1);

    assertNoExternalCalls();
  });

  it("дедуп: повтор события не плодит ни inbox, ни outbox", async () => {
    const user = await seedUser({ tgChatJoinedAt: new Date() });

    await createNotification(user.id, "trip_cancelled", "T", "БД-флейк-повтор");
    await createNotification(user.id, "trip_cancelled", "T", "БД-флейк-повтор");

    expect(await inboxOf(user.id)).toHaveLength(1);
    expect(await deliveriesOf(user.id)).toHaveLength(1);

    assertNoExternalCalls();
  });

  it("инвариант одного тумблера: выключенный notificationsEnabled не трогает critical", async () => {
    const user = await seedUser({
      tgChatJoinedAt: new Date(),
      notificationsEnabled: false,
    });

    await createNotification(user.id, "booking_created", "T", "B");
    await createNotification(user.id, "booking_status_changed", "T", "B");

    // Optional не создан вовсе (публичная запись), critical — создан.
    const inbox = await inboxOf(user.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("booking_status_changed");

    // Доставка critical: pending (чат есть, kill-switch включён).
    const deliveries = await deliveriesOf(user.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("pending");

    assertNoExternalCalls();
  });
});
