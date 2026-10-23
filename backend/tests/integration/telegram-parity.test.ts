import { afterEach, describe, expect, it, vi } from "vitest";

// Лимитеры и ADMIN_TOKEN читаются при импорте app: поднимаем auth-лимиты,
// включаем доверенный прокси (уникальный X-Real-IP на запрос — изоляция
// от IP-лимитеров) и задаём админ-токен (паттерны telegram-auth,
// telegram-appeal, review-moderation).
vi.hoisted(() => {
  process.env.TRUST_PROXY = "true";
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
  process.env.ADMIN_TOKEN = "test-admin-token-789";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

import {
  JSON_HEADERS,
  adminLogin,
  authHeaders,
  cleanupTelegramFixtures,
  devInitData,
  nextTelegramId,
  seedCar,
  seedCity,
  seedTelegramUser,
  seedTrip,
  telegramLogin,
  trackTrip,
  uniqueIp,
} from "../fixtures/telegram.js";

/**
 * Telegram parity journey (tg-migration-16): сквозные пути TG-пользователя
 * auth → trip → booking → notification → review → support/report → lifecycle
 * через реальные HTTP-ручки. Проверяется семантика (авторизация, валидация,
 * пагинация, модерация, конфликты), а не только HTTP 200.
 *
 * Порядок its — это сценарий: состояние перетекает между ногами
 * (водитель/пассажир/поездка/бронь). Изоляция — свежие BigInt-ID
 * (9_940_000+) и чистка в afterEach.
 */
const ADMIN_TOKEN = "test-admin-token-789";

let driverId = "";
let driverToken = "";
let driverTgId = 0n;
let passengerId = "";
let passengerToken = "";
let passengerTgId = 0n;
let strangerId = "";
let tripId = "";
let bookingId = "";
let reviewId = "";
let feedbackId = "";
let adminCookie = "";

function bearer(token: string, ip: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "X-Real-IP": ip };
}

afterEach(async () => {
  // Чистка только в конце сьюта: ноги делят состояние. Промежуточные
  // afterEach не чистят — см. cleanup в последнем тесте жизненного цикла.
});

describe("Telegram parity journey", () => {
  it("auth: вход через /auth/telegram создаёт TG-пользователя и выдаёт токены", async () => {
    driverTgId = nextTelegramId();
    passengerTgId = nextTelegramId();

    const driver = await telegramLogin(app, driverTgId, "Водитель");
    const passenger = await telegramLogin(app, passengerTgId, "Пассажир");
    driverId = driver.userId;
    driverToken = driver.accessToken;
    passengerId = passenger.userId;
    passengerToken = passenger.accessToken;

    expect(driverToken.length).toBeGreaterThan(0);
    expect(passengerToken.length).toBeGreaterThan(0);

    const dbDriver = await db.user.findUnique({
      where: { telegramUserId: driverTgId },
    });
    expect(dbDriver?.id).toBe(driverId);

    // Повторный вход — тот же пользователь, токены свежие.
    const relogin = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: { ...JSON_HEADERS, "X-Real-IP": uniqueIp() },
      body: JSON.stringify({
        initData: devInitData({ id: Number(driverTgId), first_name: "Водитель" }),
      }),
    });
    expect(relogin.status).toBe(200);
    const reloginBody = (await relogin.json()) as { user: { id: string } };
    expect(reloginBody.user.id).toBe(driverId);

    const seeded = await seedTelegramUser({ name: "TgStranger" });
    strangerId = seeded.id;
  });

  it("trip: водитель создаёт поездку через API; валидация отвергает мусор", async () => {
    await seedCar(driverId);
    const fromCity = await seedCity("Москва-Паритет");
    const toCity = await seedCity("Тула-Паритет");

    const payload = {
      fromCity: fromCity.name,
      fromAddress: "м. Тёплый Стан",
      toCity: toCity.name,
      toAddress: "пр-т Ленина",
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      departureAt: "2030-06-01T09:00:00.000Z",
      durationMinutes: 150,
      distanceKm: 180,
      price: 500,
      seatsTotal: 3,
      tags: [],
    };

    const created = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(driverToken, uniqueIp()) },
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    expect(createdBody.id).toBeTruthy();
    tripId = createdBody.id;
    trackTrip(tripId);

    // Совпадающие города — 400, а не 500.
    const sameCity = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(driverToken, uniqueIp()) },
      body: JSON.stringify({ ...payload, toCityId: fromCity.id }),
    });
    expect(sameCity.status).toBe(400);

    // Поездки персонализированы чёрным списком, поэтому deep-link требует
    // viewer JWT; без него нельзя вычислить взаимную видимость.
    const pub = await app.request(`/api/v1/trips/${tripId}`, {
      headers: { "X-Real-IP": uniqueIp() },
    });
    expect(pub.status).toBe(401);
    const strangerView = await app.request(`/api/v1/trips/${tripId}`, {
      headers: authHeaders(strangerId, uniqueIp()),
    });
    expect(strangerView.status).toBe(200);
    expect(
      ((await strangerView.json()) as { fromAddress?: string }).fromAddress,
    ).toBeUndefined();
    const driverView = await app.request(`/api/v1/trips/${tripId}`, {
      headers: bearer(driverToken, uniqueIp()),
    });
    expect(
      ((await driverView.json()) as { fromAddress?: string }).fromAddress,
    ).toBe("м. Тёплый Стан");
  });

  it("booking: бронь, гонка за место, ownership и подтверждение", async () => {
    const book = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({ tripId, seat: 1 }),
    });
    expect(book.status).toBe(201);
    bookingId = ((await book.json()) as { id: string }).id;
    expect(bookingId).toBeTruthy();

    // То же место — 409 SEAT_TAKEN, не дубль.
    const conflict = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...authHeaders(strangerId, uniqueIp()) },
      body: JSON.stringify({ tripId, seat: 1 }),
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code?: string }).code).toBe(
      "SEAT_TAKEN",
    );

    // Чужой не может менять статус; водитель подтверждает.
    const strangerConfirm = await app.request(
      `/api/v1/bookings/${bookingId}/status`,
      {
        method: "PATCH",
        headers: { ...JSON_HEADERS, ...authHeaders(strangerId, uniqueIp()) },
        body: JSON.stringify({ status: "confirmed" }),
      },
    );
    expect(strangerConfirm.status).toBe(403);

    const confirm = await app.request(`/api/v1/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...bearer(driverToken, uniqueIp()) },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(confirm.status).toBe(200);
    expect(((await confirm.json()) as { status?: string }).status).toBe(
      "confirmed",
    );

    // Мои брони пассажира содержат подтверждённую.
    const my = await app.request("/api/v1/bookings/my", {
      headers: bearer(passengerToken, uniqueIp()),
    });
    expect(my.status).toBe(200);
    const myBody = (await my.json()) as Array<{ id: string }>;
    expect(myBody.some((b) => b.id === bookingId)).toBe(true);
  });

  it("notifications: inbox, непрочитанные и пагинация курсором", async () => {
    const inbox = await app.request("/api/v1/notifications/my?limit=1", {
      headers: bearer(passengerToken, uniqueIp()),
    });
    expect(inbox.status).toBe(200);
    const page1 = (await inbox.json()) as {
      items: Array<{ id: string; type: string; isRead: boolean }>;
      nextCursor: string | null;
      unreadCount: number;
    };
    expect(page1.items).toHaveLength(1);
    expect(page1.unreadCount).toBeGreaterThanOrEqual(1);
    // Подтверждение брони породило критичное событие пассажиру.
    const all = await app.request("/api/v1/notifications/my?limit=20", {
      headers: bearer(passengerToken, uniqueIp()),
    });
    const allBody = (await all.json()) as typeof page1;
    expect(
      allBody.items.some((n) => n.type === "booking_status_changed"),
    ).toBe(true);

    // Пагинация: первая страница с limit=1 отдаёт курсор при наличии ещё.
    if (allBody.items.length > 1) {
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await app.request(
        `/api/v1/notifications/my?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
        { headers: bearer(passengerToken, uniqueIp()) },
      );
      expect(page2.status).toBe(200);
      expect(
        ((await page2.json()) as typeof page1).items,
      ).toHaveLength(1);
    }

    // Прочтение: isRead переходит, счётчик уменьшается на 1.
    const before = allBody.unreadCount;
    const target = allBody.items.find((n) => !n.isRead)!;
    const read = await app.request(`/api/v1/notifications/${target.id}/read`, {
      method: "PATCH",
      headers: bearer(passengerToken, uniqueIp()),
    });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { isRead?: boolean }).isRead).toBe(true);
    const afterRead = (await (
      await app.request("/api/v1/notifications/my?limit=20", {
        headers: bearer(passengerToken, uniqueIp()),
      })
    ).json()) as typeof page1;
    expect(afterRead.unreadCount).toBe(before - 1);
  });

  it("review: отзыв, антидубль, модерация и публикация", async () => {
    // Отзыв требует уехавшую поездку (TRIP_IN_PAST иначе): прошлое через
    // API не забронировать, поэтому сид уехавшей поездки + подтверждённой
    // брони напрямую; сам отзыв и модерация — через API.
    const pastTripId = await seedTrip(driverId, {
      departureAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await db.booking.create({
      data: { tripId: pastTripId, passengerId, seat: 1, status: "confirmed" },
    });

    const created = await app.request("/api/v1/reviews", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        tripId: pastTripId,
        targetUserId: driverId,
        rating: 5,
        text: "Отличная поездка, всё чётко.",
      }),
    });
    expect(created.status).toBe(201);
    reviewId = ((await created.json()) as { id: string }).id;

    // Дубль того же отзыва — 409.
    const duplicate = await app.request("/api/v1/reviews", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        tripId: pastTripId,
        targetUserId: driverId,
        rating: 4,
        text: "Попытка дубля.",
      }),
    });
    expect(duplicate.status).toBe(409);

    // До модерации неопубликованный отзыв не виден публично.
    const beforeApprove = (await (
      await app.request(`/api/v1/reviews/user/${driverId}`, {
        headers: { "X-Real-IP": uniqueIp() },
      })
    ).json()) as { items: Array<{ id: string }> };
    expect(beforeApprove.items.some((r) => r.id === reviewId)).toBe(false);

    adminCookie = await adminLogin(app, ADMIN_TOKEN);
    const approve = await app.request(`/api/v1/admin/reviews/${reviewId}/approve`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "X-Real-IP": uniqueIp() },
    });
    expect(approve.status).toBe(200);

    const afterApprove = (await (
      await app.request(`/api/v1/reviews/user/${driverId}`, {
        headers: { "X-Real-IP": uniqueIp() },
      })
    ).json()) as { items: Array<{ id: string }> };
    expect(afterApprove.items.some((r) => r.id === reviewId)).toBe(true);

    // Автор видит свой отзыв в «моих».
    const my = await app.request("/api/v1/reviews/my", {
      headers: bearer(passengerToken, uniqueIp()),
    });
    expect(my.status).toBe(200);
    expect(
      ((await my.json()) as Array<{ id: string }>).some((r) => r.id === reviewId),
    ).toBe(true);
  });

  it("support/report: обращение, ответ админа и жалоба с антидублем", async () => {
    const created = await app.request("/api/v1/feedback", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        subject: "Нет уведомления",
        text: "После подтверждения не пришло уведомление.",
      }),
    });
    expect(created.status).toBe(201);
    feedbackId = ((await created.json()) as { id: string }).id;

    // Валидация: пустой текст — 400, не 500.
    const invalid = await app.request("/api/v1/feedback", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({ subject: "Тема", text: "" }),
    });
    expect(invalid.status).toBe(400);

    // Админ отвечает — ответ персистится и виден в карточке.
    const reply = await app.request(`/api/v1/admin/feedback/${feedbackId}/reply`, {
      method: "POST",
      headers: { ...JSON_HEADERS, Cookie: adminCookie, "X-Real-IP": uniqueIp() },
      body: JSON.stringify({ reply: "Проверьте inbox, событие доставлено." }),
    });
    expect(reply.status).toBe(200);
    const stored = await db.feedback.findUnique({ where: { id: feedbackId } });
    expect(stored?.reply).toBe("Проверьте inbox, событие доставлено.");

    // Жалоба на водителя: создание, дубль и self-report.
    const report = await app.request("/api/v1/reports", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        targetType: "user",
        targetId: driverId,
        category: "safety",
        description: "Паритет-проверка жалоб",
      }),
    });
    expect(report.status).toBe(201);

    const reportDup = await app.request("/api/v1/reports", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        targetType: "user",
        targetId: driverId,
        category: "safety",
        description: "Паритет-проверка жалоб",
      }),
    });
    expect(reportDup.status).toBe(409);

    const selfReport = await app.request("/api/v1/reports", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...bearer(passengerToken, uniqueIp()) },
      body: JSON.stringify({
        targetType: "user",
        targetId: passengerId,
        category: "spam",
        description: "Сам на себя",
      }),
    });
    expect(selfReport.status).toBe(403);
  });

  it("trip cancel: отмена рассылает критичное событие пассажиру", async () => {
    const cancel = await app.request(`/api/v1/trips/${tripId}/cancel`, {
      method: "PATCH",
      headers: bearer(driverToken, uniqueIp()),
    });
    expect(cancel.status).toBe(200);

    const inbox = (await (
      await app.request("/api/v1/notifications/my?limit=20", {
        headers: bearer(passengerToken, uniqueIp()),
      })
    ).json()) as { items: Array<{ type: string }> };
    expect(inbox.items.some((n) => n.type === "trip_cancelled")).toBe(true);
  });

  it("lifecycle: удаление аккаунта анонимизирует и блокирует повторный вход", async () => {
    const tgId = nextTelegramId();
    const fresh = await telegramLogin(app, tgId, "Удаляемый");

    const me = await app.request("/api/v1/users/me", {
      headers: {
        Authorization: `Bearer ${fresh.accessToken}`,
        "X-Real-IP": uniqueIp(),
      },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { id?: string }).id).toBe(fresh.userId);

    const del = await app.request("/api/v1/users/me", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${fresh.accessToken}`,
        "X-Real-IP": uniqueIp(),
      },
    });
    expect(del.status).toBe(200);

    const anonymized = await db.user.findUnique({
      where: { id: fresh.userId },
    });
    expect(anonymized?.deletedAt).not.toBeNull();

    // Повторный вход по тому же Telegram-ID — 403 (tombstone).
    const relogin = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: { ...JSON_HEADERS, "X-Real-IP": uniqueIp() },
      body: JSON.stringify({
        initData: devInitData({ id: Number(tgId), first_name: "Удаляемый" }),
      }),
    });
    expect(relogin.status).toBe(403);

    await cleanupTelegramFixtures();
  });
});
