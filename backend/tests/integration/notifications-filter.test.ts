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

async function patchRead(token: string, id: string) {
  const res = await app.request(`/api/v1/notifications/${id}/read`, {
    method: "PATCH",
    headers: bearer(token, uniqueIp()),
  });
  const body = (await res.json()) as {
    id?: string;
    isRead?: boolean;
    message?: string;
  };
  return { status: res.status, body };
}

async function getUnreadCount(token: string | null) {
  const res = await app.request("/api/v1/notifications/unread-count", {
    headers: token ? bearer(token, uniqueIp()) : { "X-Real-IP": uniqueIp() },
  });
  const body = (await res.json()) as { unreadCount?: number };
  return { status: res.status, body };
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

describe("GET /notifications/unread-count — ownership-scoped счётчик", () => {
  it("пользователь A (2 unread + 1 read) видит 2, пользователь B (пусто) — 0", async () => {
    const loginA = await telegramLogin(app, nextTelegramId(), "Счётчик A");
    const loginB = await telegramLogin(app, nextTelegramId(), "Счётчик B");
    const now = Date.now();
    for (const [i, isRead] of [false, false, true].entries()) {
      await db.notification.create({
        data: {
          userId: loginA.userId,
          type: "booking_status_changed",
          title: `A${i}`,
          body: `AB${i}`,
          isRead,
          createdAt: new Date(now - i * 1000),
        },
      });
    }

    const countA = await getUnreadCount(loginA.accessToken);
    expect(countA.status).toBe(200);
    expect(countA.body).toEqual({ unreadCount: 2 });

    const countB = await getUnreadCount(loginB.accessToken);
    expect(countB.status).toBe(200);
    expect(countB.body).toEqual({ unreadCount: 0 });
  });

  it("без авторизации — 401", async () => {
    const { status } = await getUnreadCount(null);
    expect(status).toBe(401);
  });
});

describe("PATCH /notifications/:id/read — scoped updateMany + read-back", () => {
  it("своя непрочитанная → 200 + isRead: true", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Прочтение",
    );
    const row = await db.notification.create({
      data: {
        userId,
        type: "booking_status_changed",
        title: "T",
        body: "B",
        isRead: false,
      },
    });

    const { status, body } = await patchRead(accessToken, row.id);
    expect(status).toBe(200);
    expect(body.id).toBe(row.id);
    expect(body.isRead).toBe(true);
  });

  it("уже прочитанная своя → 200 (идемпотентно)", async () => {
    const { userId, accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Прочтение",
    );
    const row = await db.notification.create({
      data: {
        userId,
        type: "booking_status_changed",
        title: "T",
        body: "B",
        isRead: true,
      },
    });

    const { status, body } = await patchRead(accessToken, row.id);
    expect(status).toBe(200);
    expect(body.isRead).toBe(true);
  });

  it("чужая запись → 404 { message }, флаг не меняется", async () => {
    const owner = await telegramLogin(app, nextTelegramId(), "Владелец");
    const stranger = await telegramLogin(app, nextTelegramId(), "Чужой");
    const row = await db.notification.create({
      data: {
        userId: owner.userId,
        type: "booking_status_changed",
        title: "T",
        body: "B",
        isRead: false,
      },
    });

    const { status, body } = await patchRead(stranger.accessToken, row.id);
    expect(status).toBe(404);
    expect(body).toEqual({ message: "Not found" });

    const after = await db.notification.findUnique({ where: { id: row.id } });
    expect(after?.isRead).toBe(false);
  });

  it("malformed id → 404, а не 500", async () => {
    const { accessToken } = await telegramLogin(
      app,
      nextTelegramId(),
      "Прочтение",
    );

    const { status, body } = await patchRead(accessToken, "not-a-uuid");
    expect(status).toBe(404);
    expect(body).toEqual({ message: "Not found" });
  });
});
