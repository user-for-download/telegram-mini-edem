// backend/tests/integration/notifications-filter.test.ts
//
// Серверный фильтр GET /notifications/my (m3): ?role=driver|passenger
// (NOTIFICATION_ROLE_TYPES из @edem/contracts) и ?unreadOnly=1.
// Клиент по типам больше не фильтрует — архив должен быть полным
// без догрузки всех страниц.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRUST_PROXY = "true";
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

import {
  cleanupTelegramFixtures,
  nextTelegramId,
  telegramLogin,
  uniqueIp,
} from "../fixtures/telegram.js";

function bearer(token: string, ip: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "X-Real-IP": ip };
}

afterEach(async () => {
  await cleanupTelegramFixtures();
});

async function seedInbox(userId: string) {
  const now = Date.now();
  const rows = [
    { type: "booking_created", isRead: false, ago: 4000 },
    { type: "booking_status_changed", isRead: false, ago: 3000 },
    { type: "trip_cancelled", isRead: true, ago: 2000 },
    { type: "review_approved", isRead: false, ago: 1000 },
  ];
  for (const [i, row] of rows.entries()) {
    await db.notification.create({
      data: {
        userId,
        type: row.type,
        title: `T${i}`,
        body: `B${i}`,
        isRead: row.isRead,
        createdAt: new Date(now - row.ago),
      },
    });
  }
}

async function getInbox(token: string, query = "") {
  const res = await app.request(`/api/v1/notifications/my${query}`, {
    headers: bearer(token, uniqueIp()),
  });
  return { status: res.status, body: (await res.json()) as {
    items: Array<{ type: string; isRead: boolean }>;
    nextCursor: string | null;
    unreadCount: number;
  } };
}

describe("GET /notifications/my — серверный фильтр role/unreadOnly", () => {
  it("без фильтра — всё, unreadCount глобальный", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Фильтр",
    );
    await seedInbox(userId);

    const { status, body } = await getInbox(accessToken, "?limit=20");
    expect(status).toBe(200);
    expect(body.items.map((n) => n.type)).toEqual([
      "review_approved",
      "trip_cancelled",
      "booking_status_changed",
      "booking_created",
    ]);
    expect(body.unreadCount).toBe(3);
  });

  it("role=driver — только водительские (включая trip_status_changed оба)", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Фильтр",
    );
    await seedInbox(userId);
    await db.notification.create({
      data: {
        userId,
        type: "trip_status_changed",
        title: "T",
        body: "B",
        createdAt: new Date(),
      },
    });

    const { status, body } = await getInbox(accessToken, "?role=driver");
    expect(status).toBe(200);
    expect(body.items.map((n) => n.type).sort()).toEqual([
      "booking_created",
      "trip_status_changed",
    ]);
    // unreadCount — глобальный (бейдж), не скоуп фильтра.
    expect(body.unreadCount).toBe(4);
  });

  it("role=passenger + unreadOnly=1 — пересечение фильтров", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Фильтр",
    );
    await seedInbox(userId);

    const passenger = await getInbox(accessToken, "?role=passenger");
    expect(passenger.status).toBe(200);
    expect(passenger.body.items.map((n) => n.type).sort()).toEqual([
      "booking_status_changed",
      "trip_cancelled",
    ]);

    const unreadPassenger = await getInbox(
      accessToken,
      "?role=passenger&unreadOnly=1",
    );
    expect(unreadPassenger.status).toBe(200);
    expect(unreadPassenger.body.items.map((n) => n.type)).toEqual([
      "booking_status_changed",
    ]);

    const unread = await getInbox(accessToken, "?unreadOnly=1");
    expect(unread.status).toBe(200);
    expect(unread.body.items).toHaveLength(3);
    expect(unread.body.items.every((n) => !n.isRead)).toBe(true);
  });

  it("невалидный role — 400, а не молча всё", async () => {
    const { accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Фильтр",
    );

    const { status } = await getInbox(accessToken, "?role=admin");
    expect(status).toBe(400);
  });

  it("cursor-пагинация работает поверх фильтра (keyset, без дублей)", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Фильтр",
    );
    await seedInbox(userId);

    const page1 = await getInbox(accessToken, "?role=passenger&limit=1");
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await getInbox(
      accessToken,
      `?role=passenger&limit=1&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[0].type).not.toBe(page1.body.items[0].type);
  });
});
