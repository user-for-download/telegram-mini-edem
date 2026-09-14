// backend/tests/integration/admin-telegram.test.ts
//
// Админ-контур bot-api shadow: GET /admin/telegram/metrics (агрегаты
// outbox) и PATCH /admin/users/:id/telegram-stop (мгновенный ручной
// стоп: сброс согласия + гашение pending-задач). Паттерны admin-auth
// (vi.hoisted ADMIN_TOKEN, логин → cookie), уникальные tgId 9_950_000+.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-123";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_WINDOW_MS = "60000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_WINDOW_MS = "60000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_950_000n;

async function seedUser(data: Record<string, unknown> = {}): Promise<string> {
  const user = await db.user.create({
    data: {
      telegramUserId: tgSeq++,
      name: "AdminTg",
      avatar: "",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

let adminCookie: string;

beforeEach(async () => {
  const login = await app.request(`${ADMIN_BASE}/auth/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: "test-admin-token-123" }),
  });
  const setCookie = login.headers.get("set-cookie");
  adminCookie = setCookie ? setCookie.split(";")[0] : "";
});

afterEach(async () => {
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("GET /admin/telegram/metrics", () => {
  it("без админ-сессии → 401", async () => {
    const res = await app.request(`${ADMIN_BASE}/telegram/metrics`);
    expect(res.status).toBe(401);
  });

  it("агрегаты outbox: pending/skipped считаются из реальных строк", async () => {
    const userId = await seedUser({ tgChatJoinedAt: null });
    await db.notification.create({
      data: { userId, type: "trip_cancelled", title: "T", body: "B" },
    });
    await db.notificationDelivery.create({
      data: {
        notificationId: (
          await db.notification.findFirstOrThrow({ where: { userId } })
        ).id,
        userId,
        channel: "telegram",
        type: "trip_cancelled",
        status: "skipped",
        error: "no_chat",
      },
    });

    const res = await app.request(`${ADMIN_BASE}/telegram/metrics`, {
      headers: { Cookie: adminCookie },
    });

    expect(res.status).toBe(200);
    const metrics = await res.json();
    expect(metrics.channelEnabled).toBe(true);
    expect(metrics.skipped.no_chat).toBeGreaterThanOrEqual(1);
    // Без PII: только counts.
    expect(metrics).not.toHaveProperty("userId");
    expect(metrics).not.toHaveProperty("body");
  });
});

describe("PATCH /admin/users/:id/telegram-stop", () => {
  it("без админ-сессии → 401", async () => {
    const res = await app.request(
      `${ADMIN_BASE}/users/00000000-0000-0000-0000-000000000000/telegram-stop`,
      { method: "PATCH" },
    );
    expect(res.status).toBe(401);
  });

  it("несуществующий пользователь → 404", async () => {
    const res = await app.request(
      `${ADMIN_BASE}/users/00000000-0000-0000-0000-000000000000/telegram-stop`,
      { method: "PATCH", headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(404);
  });

  it("стоп: согласие сброшено, pending → skipped/admin_stopped", async () => {
    const userId = await seedUser({ tgChatJoinedAt: new Date() });
    await db.notification.create({
      data: { userId, type: "trip_cancelled", title: "T", body: "B" },
    });
    const notification = await db.notification.findFirstOrThrow({
      where: { userId },
    });
    await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        userId,
        channel: "telegram",
        type: "trip_cancelled",
        status: "pending",
      },
    });

    const res = await app.request(`${ADMIN_BASE}/users/${userId}/telegram-stop`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, hadConsent: true, cancelledDeliveries: 1 });

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.tgChatJoinedAt).toBeNull();
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { userId },
    });
    expect(delivery.status).toBe("skipped");
    expect(delivery.error).toBe("admin_stopped");
  });

  it("идемпотентно: повторный стоп на пустом согласии → 200, hadConsent=false", async () => {
    const userId = await seedUser({ tgChatJoinedAt: null });

    const res = await app.request(`${ADMIN_BASE}/users/${userId}/telegram-stop`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, hadConsent: false, cancelledDeliveries: 0 });
  });
});
