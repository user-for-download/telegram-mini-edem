import { afterEach, describe, expect, it, vi } from "vitest";

// ADMIN_TOKEN и лимиты читаются из env при старте/импорте.
// Задаём до импорта app; лимиты завышаем, чтобы тест не упёрся в 429
// (мутаций в файле больше дефолтного бюджета 30/мин).
vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-123";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { wsManager } = await import("../../src/ws/manager.js");
const { PENDING_BOOKING_TTL_MS } = await import("../../src/bookings/shared.js");

/**
 * Регрессия модераторских операций админки:
 *
 * 1) PATCH /admin/trips/:id/cancel — до исправления завершённую поездку
 *    можно было отменить задним числом. Теперь completed/cancelled → 409
 *    TRIP_NOT_ACTIVE (решение 2).
 *
 * 2) DELETE /admin/reviews/:id — до исправления удаление отзыва не
 *    пересчитывало рейтинговый агрегат target-пользователя. Теперь rating
 *    и reviewsCount пересчитываются по оставшимся published-отзывам
 *    (recomputeUserRating, общая логика с одобрением отзыва). Фикстуры —
 *    явно published: pending/rejected в рейтинг не входят.
 *
 * 3) PATCH /admin/bookings/:id/status — до исправления переход
 *    active → declined/cancelled не возвращал место в seatsAvailable.
 *    Теперь активная бронь удерживает место, неактивная — освобождает
 *    (с защитой от выхода за seatsTotal и повторным удержанием).
 *
 * Паттерны репо (см. admin-feedback.test.ts): app.request(), логин через
 * POST /admin/auth/login с cookie edem_admin_jwt, уникальные telegramUserId.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-123";

function extractAdminCookie(response: Response): string | null {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) return null;
  const match = /edem_admin_jwt=([^;]+)/.exec(setCookieHeader);
  return match ? match[1] : null;
}

async function loginAndGetCookie(): Promise<string> {
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  const cookie = extractAdminCookie(response);
  if (!cookie) throw new Error("login did not set admin cookie");
  return cookie;
}

const createdUserIds: string[] = [];
const createdTripIds: string[] = [];
const createdBookingIds: string[] = [];
const createdReviewIds: string[] = [];
// telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
let tgSeq = 9_200_000n;

async function createUser(name: string): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `${name}-${tgSeq + 1n}`,
      telegramUserId: ++tgSeq,
      avatar: "https://i.pravatar.cc/200?img=9",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function createTrip(
  driverId: string,
  overrides: { status?: string; seatsAvailable?: number } = {}
): Promise<string> {
  const trip = await db.trip.create({
    data: {
      driverId,
      fromCity: "Москва",
      fromAddress: "м. Тёплый Стан",
      toCity: "Тула",
      toAddress: "пр-т Ленина",
      departureAt: new Date("2030-01-01T09:00:00Z"),
      durationMinutes: 120,
      distanceKm: 180,
      price: 700,
      seatsTotal: 3,
      seatsAvailable: overrides.seatsAvailable ?? 3,
      tags: [],
      ...(overrides.status ? { status: overrides.status } : {}),
    },
  });
  createdTripIds.push(trip.id);
  return trip.id;
}

async function createBooking(
  tripId: string,
  passengerId: string,
  seat: number,
  status: string
): Promise<string> {
  const booking = await db.booking.create({
    data: { tripId, passengerId, seat, status, comment: "" },
  });
  createdBookingIds.push(booking.id);
  return booking.id;
}

// Статус модерации — явно (дефолт схемы "pending" в рейтинг не входит):
// по умолчанию "published", чтобы recompute-тесты валидны против
// published-only агрегата.
async function createReview(
  authorId: string,
  targetUserId: string,
  rating: number,
  status: string = "published"
): Promise<string> {
  const review = await db.review.create({
    data: {
      authorId,
      targetUserId,
      targetRole: "driver",
      rating,
      text: `Отзыв с оценкой ${rating}`,
      tripRoute: "Москва → Тула",
      status,
    },
  });
  createdReviewIds.push(review.id);
  return review.id;
}

function adminRequest(
  method: string,
  path: string,
  cookie: string,
  body?: unknown
) {
  return app.request(path, {
    method,
    headers: { ...JSON_HEADERS, Cookie: `edem_admin_jwt=${cookie}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdBookingIds.length > 0) {
    await db.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    createdBookingIds.length = 0;
  }
  if (createdReviewIds.length > 0) {
    await db.review.deleteMany({ where: { id: { in: createdReviewIds } } });
    createdReviewIds.length = 0;
  }
  if (createdTripIds.length > 0) {
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    createdTripIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("PATCH /admin/trips/:id/cancel — completion guard", () => {
  it("cancels an active trip (200, status → cancelled)", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("CancelDriver");
    const tripId = await createTrip(driverId);

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/trips/${tripId}/cancel`,
      cookie
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("cancelled");
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.status).toBe("cancelled");
  });

  it("rejects cancel of a completed trip (409 TRIP_NOT_ACTIVE)", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("CompletedDriver");
    const tripId = await createTrip(driverId, { status: "completed" });

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/trips/${tripId}/cancel`,
      cookie
    );

    // Assert
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TRIP_NOT_ACTIVE");
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.status).toBe("completed");
  });

  it("rejects cancel of an already cancelled trip (409 TRIP_NOT_ACTIVE)", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("CancelledDriver");
    const tripId = await createTrip(driverId, { status: "cancelled" });

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/trips/${tripId}/cancel`,
      cookie
    );

    // Assert
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TRIP_NOT_ACTIVE");
  });

  it("returns 404 for a missing trip", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();

    // Act
    const res = await adminRequest(
      "PATCH",
      "/api/v1/admin/trips/nonexistent/cancel",
      cookie
    );

    // Assert
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /admin/bookings/:id/status — seat accounting", () => {
  it("active → declined restores seatsAvailable", async () => {
    // Arrange: активная (confirmed) бронь удерживает место: 3 → 2.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("SeatDriver");
    const passengerId = await createUser("SeatPassenger");
    const tripId = await createTrip(driverId, { seatsAvailable: 2 });
    const bookingId = await createBooking(tripId, passengerId, 1, "confirmed");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "declined" }
    );

    // Assert
    expect(res.status).toBe(200);
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.seatsAvailable).toBe(3);
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("declined");
  });

  it("inactive → active re-holds the seat (seatsAvailable decreases)", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("ReholdDriver");
    const passengerId = await createUser("ReholdPassenger");
    const tripId = await createTrip(driverId, { seatsAvailable: 3 });
    const bookingId = await createBooking(tripId, passengerId, 1, "declined");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "confirmed" }
    );

    // Assert
    expect(res.status).toBe(200);
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.seatsAvailable).toBe(2);
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("confirmed");
  });

  it("active → active does not change seatsAvailable", async () => {
    // Arrange: pending → confirmed — место уже удержано активной бронью.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("PendingDriver");
    const passengerId = await createUser("PendingPassenger");
    const tripId = await createTrip(driverId, { seatsAvailable: 2 });
    const bookingId = await createBooking(tripId, passengerId, 1, "pending");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "confirmed" }
    );

    // Assert
    expect(res.status).toBe(200);
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.seatsAvailable).toBe(2);
  });

  it("reactivation without free seats → 409 CONFLICT, seat not restored", async () => {
    // Arrange: мест нет (seatsAvailable 0), бронь неактивна.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("FullDriver");
    const passengerId = await createUser("FullPassenger");
    const tripId = await createTrip(driverId, { seatsAvailable: 0 });
    const bookingId = await createBooking(tripId, passengerId, 1, "declined");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "confirmed" }
    );

    // Assert
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CONFLICT");
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("declined");
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.seatsAvailable).toBe(0);
  });
});

describe("DELETE /admin/reviews/:id — rating recompute", () => {
  it("recomputes rating and reviewsCount after deleting one of two reviews", async () => {
    // Arrange: два отзыва (5 и 3) → агрегат 4.0/2.
    // F14 partial unique index (authorId, targetUserId) WHERE tripId IS NULL:
    // каждому NULL-trip отзыву — свой автор, иначе второй INSERT → P2002.
    const cookie = await loginAndGetCookie();
    const targetUserId = await createUser("RatingTarget");
    const authorId = await createUser("RatingAuthor");
    const authorId2 = await createUser("RatingAuthor2");
    await db.user.update({
      where: { id: targetUserId },
      data: { rating: 4.0, reviewsCount: 2 },
    });
    const reviewToDelete = await createReview(authorId, targetUserId, 5);
    await createReview(authorId2, targetUserId, 3);

    // Act
    const res = await adminRequest(
      "DELETE",
      `/api/v1/admin/reviews/${reviewToDelete}`,
      cookie
    );

    // Assert — отзыв удалён, агрегат пересчитан по оставшемуся отзыву.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(reviewToDelete);
    expect(await db.review.findUnique({ where: { id: reviewToDelete } })).toBeNull();

    const target = await db.user.findUnique({ where: { id: targetUserId } });
    expect(target?.rating).toBe(3.0);
    expect(target?.reviewsCount).toBe(1);
  });

  it("deleting the last review resets rating to 0 and reviewsCount to 0", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const targetUserId = await createUser("LastReviewTarget");
    const authorId = await createUser("LastReviewAuthor");
    await db.user.update({
      where: { id: targetUserId },
      data: { rating: 5.0, reviewsCount: 1 },
    });
    const reviewId = await createReview(authorId, targetUserId, 5);

    // Act
    const res = await adminRequest(
      "DELETE",
      `/api/v1/admin/reviews/${reviewId}`,
      cookie
    );

    // Assert
    expect(res.status).toBe(200);
    const target = await db.user.findUnique({ where: { id: targetUserId } });
    expect(target?.rating).toBe(0);
    expect(target?.reviewsCount).toBe(0);
  });

  it("returns 404 for a missing review", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();

    // Act
    const res = await adminRequest(
      "DELETE",
      "/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000",
      cookie
    );

    // Assert
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("admin list query validation", () => {
  it.each([
    ["users", "/api/v1/admin/users"],
    ["trips", "/api/v1/admin/trips"],
    ["bookings", "/api/v1/admin/bookings"],
    ["reviews", "/api/v1/admin/reviews"],
    ["audit", "/api/v1/admin/audit"],
    ["reports", "/api/v1/admin/reports"],
  ])("rejects unknown, repeated, malformed, and out-of-range queries for %s", async (_name, path) => {
    const cookie = await loginAndGetCookie();
    const queries = [
      "?unexpected=value",
      "?page=1&page=2",
      "?page=1&page=1",
      "?p%61ge=1&page=2",
      "?page=not-a-number",
      "?page=10001",
    ];

    for (const query of queries) {
      const res = await adminRequest("GET", `${path}${query}`, cookie);
      expect(res.status).toBe(400);
    }
  });
});

describe("PATCH /admin/trips/:id/cancel — booking cascade", () => {
  it("cancels active bookings and zeroes seatsAvailable (full lifecycle)", async () => {
    // Arrange: активная поездка с pending + confirmed бронями.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("CascadeDriver");
    const passenger1 = await createUser("CascadeP1");
    const passenger2 = await createUser("CascadeP2");
    const tripId = await createTrip(driverId, { seatsAvailable: 1 });
    const pendingId = await createBooking(tripId, passenger1, 1, "pending");
    const confirmedId = await createBooking(tripId, passenger2, 2, "confirmed");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/trips/${tripId}/cancel`,
      cookie
    );

    // Assert: брони отменены с аудитом, места обнулены.
    expect(res.status).toBe(200);
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.status).toBe("cancelled");
    expect(dbTrip?.seatsAvailable).toBe(0);
    const pending = await db.booking.findUnique({ where: { id: pendingId } });
    expect(pending?.status).toBe("cancelled");
    expect(pending?.cancelledByType).toBe("admin");
    const confirmed = await db.booking.findUnique({ where: { id: confirmedId } });
    expect(confirmed?.status).toBe("cancelled");
    expect(confirmed?.cancelledByType).toBe("admin");
  });

  it("notifies the driver in inbox and WS even without passengers", async () => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("NotifiedCancelDriver");
    const tripId = await createTrip(driverId);
    const sendToUser = vi.spyOn(wsManager, "sendToUser");

    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/trips/${tripId}/cancel`,
      cookie,
    );

    expect(res.status).toBe(200);
    const notifications = await db.notification.findMany({
      where: { userId: driverId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "trip_status_changed",
      title: "Поездка отменена",
      actorName: "Администратор",
      action: "cancelled",
      recipientRole: "driver",
      deepLink: `/trips/${tripId}`,
      tripFrom: "Москва",
      tripTo: "Тула",
    });
    expect(sendToUser).toHaveBeenCalledWith(driverId, {
      type: "trip:status_changed",
      payload: { tripId, status: "cancelled" },
    });
  });

  it("persists identical-text notices for distinct trips, but not cancellation retries", async () => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("SameRouteDriver");
    const passengerId = await createUser("SameRoutePassenger");
    const tripIds = [
      await createTrip(driverId, { seatsAvailable: 2 }),
      await createTrip(driverId, { seatsAvailable: 2 }),
    ];
    const sendToUser = vi.spyOn(wsManager, "sendToUser");

    for (const tripId of tripIds) {
      await createBooking(tripId, passengerId, 1, "confirmed");
      const res = await adminRequest("PATCH", `/api/v1/admin/trips/${tripId}/cancel`, cookie);
      expect(res.status).toBe(200);
      for (const userId of [driverId, passengerId]) {
        expect(sendToUser).toHaveBeenCalledWith(userId, {
          type: "trip:status_changed",
          payload: { tripId, status: "cancelled" },
        });
      }
    }

    for (const userId of [driverId, passengerId]) {
      const notices = await db.notification.findMany({ where: { userId } });
      expect(notices).toHaveLength(2);
      expect(notices[0].body).toBe(notices[1].body);
      expect(notices.map((notice) => notice.deepLink).sort()).toEqual(
        tripIds.map((id) => `/trips/${id}`).sort(),
      );
      for (const tripId of tripIds) expect(notices[0].body).not.toContain(tripId);
      expect(await db.notificationDelivery.count({
        where: { notificationId: { in: notices.map((notice) => notice.id) } },
      })).toBe(2);
    }

    sendToUser.mockClear();
    const retry = await adminRequest("PATCH", `/api/v1/admin/trips/${tripIds[0]}/cancel`, cookie);
    expect(retry.status).toBe(409);
    expect(sendToUser).not.toHaveBeenCalled();
    expect(await db.notification.count({ where: { userId: driverId } })).toBe(2);
    expect(await db.notification.count({ where: { userId: passengerId } })).toBe(2);
  });
});

describe("PATCH /admin/bookings/:id/status — passenger notifications", () => {
  it.each([
    { scope: "different trips", sameTrip: false },
    { scope: "the same trip", sameTrip: true },
  ])("keeps identical-text notices for distinct bookings on $scope, but not retries", async ({ sameTrip }) => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("SameRouteBookingDriver");
    const passengerId = await createUser("SameRouteBookingPassenger");
    const firstTripId = await createTrip(driverId);
    const secondTripId = sameTrip ? firstTripId : await createTrip(driverId);
    const bookingIds = [
      await createBooking(firstTripId, passengerId, 1, "declined"),
      await createBooking(secondTripId, passengerId, 2, "declined"),
    ];
    const sendToUser = vi.spyOn(wsManager, "sendToUser");

    for (const bookingId of bookingIds) {
      const res = await adminRequest(
        "PATCH", `/api/v1/admin/bookings/${bookingId}/status`, cookie, { status: "cancelled" },
      );
      expect(res.status).toBe(200);
    }

    const notices = await db.notification.findMany({ where: { userId: passengerId } });
    expect(notices).toHaveLength(2);
    expect(notices[0].body).toBe(notices[1].body);
    expect(notices.map((notice) => notice.deepLink).sort()).toEqual(
      [firstTripId, secondTripId].map((id) => `/trips/${id}`).sort(),
    );
    for (const bookingId of bookingIds) expect(notices[0].body).not.toContain(bookingId);
    expect(await db.notificationDelivery.count({
      where: { notificationId: { in: notices.map((notice) => notice.id) } },
    })).toBe(2);

    sendToUser.mockClear();
    const retry = await adminRequest(
      "PATCH", `/api/v1/admin/bookings/${bookingIds[0]}/status`, cookie, { status: "cancelled" },
    );
    expect(retry.status).toBe(200);
    expect(sendToUser).not.toHaveBeenCalled();
    expect(await db.notification.count({ where: { userId: passengerId } })).toBe(2);
  });

  it.each([
    { from: "pending", to: "confirmed", title: "Заявка подтверждена", action: "confirmed" },
    { from: "confirmed", to: "declined", title: "Заявка отклонена", action: "declined" },
    { from: "confirmed", to: "cancelled", title: "Заявка отменена", action: "cancelled" },
    { from: "declined", to: "pending", title: "Заявка снова ожидает подтверждения", action: "changed" },
  ])("notifies passenger in inbox and WS for $from → $to", async ({ from, to, title, action }) => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("NoticeDriver");
    const passengerId = await createUser("NoticePassenger");
    const tripId = await createTrip(driverId, {
      seatsAvailable: from === "declined" ? 3 : 2,
    });
    const bookingId = await createBooking(tripId, passengerId, 1, from);
    const sendToUser = vi.spyOn(wsManager, "sendToUser");

    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: to },
    );

    expect(res.status).toBe(200);
    const notifications = await db.notification.findMany({
      where: { userId: passengerId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "booking_status_changed",
      title,
      actorName: "Администратор",
      action,
      recipientRole: "passenger",
      deepLink: `/trips/${tripId}`,
      tripFrom: "Москва",
      tripTo: "Тула",
    });
    expect(sendToUser).toHaveBeenCalledWith(passengerId, {
      type: "booking:status_changed",
      payload: { bookingId, tripId, status: to },
    });
  });

  it.each([
    { status: "confirmed", hasExpiry: true },
    { status: "pending", hasExpiry: true },
    { status: "pending", hasExpiry: false },
  ])("preserves expiry and seats without notices for a $status no-op (expiry: $hasExpiry)", async ({ status, hasExpiry }) => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("NoopDriver");
    const passengerId = await createUser("NoopPassenger");
    const tripId = await createTrip(driverId, { seatsAvailable: 2 });
    const bookingId = await createBooking(tripId, passengerId, 1, status);
    const expiresAt = hasExpiry
      ? new Date(Date.now() + PENDING_BOOKING_TTL_MS / 2)
      : null;
    await db.booking.update({ where: { id: bookingId }, data: { expiresAt } });
    const sendToUser = vi.spyOn(wsManager, "sendToUser");

    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status },
    );

    expect(res.status).toBe(200);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe(status);
    expect(booking.expiresAt).toEqual(expiresAt);
    const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsAvailable).toBe(2);
    expect(await db.notification.count({ where: { userId: passengerId } })).toBe(0);
    expect(
      await db.adminAuditLog.count({
        where: { action: "booking.status", targetId: bookingId },
      }),
    ).toBe(0);
    expect(sendToUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /admin/bookings/:id/status — reactivation lifecycle guard", () => {
  it.each(["declined", "confirmed"])("replaces stale expiresAt with a full TTL on %s → pending", async (status) => {
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("ExpiryDriver");
    const passengerId = await createUser("ExpiryPassenger");
    const tripId = await createTrip(driverId, {
      seatsAvailable: status === "confirmed" ? 2 : 3,
    });
    const bookingId = await createBooking(tripId, passengerId, 1, status);
    await db.booking.update({
      where: { id: bookingId },
      data: { expiresAt: new Date(Date.now() - PENDING_BOOKING_TTL_MS) },
    });
    const startedAt = Date.now();

    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "pending" },
    );
    const completedAt = Date.now();

    expect(res.status).toBe(200);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe("pending");
    expect(booking.expiresAt?.getTime()).toBeGreaterThanOrEqual(startedAt + PENDING_BOOKING_TTL_MS);
    expect(booking.expiresAt?.getTime()).toBeLessThanOrEqual(completedAt + PENDING_BOOKING_TTL_MS);
    const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsAvailable).toBe(2);
  });

  it("reactivation on a cancelled trip → 409 TRIP_NOT_ACTIVE, booking unchanged", async () => {
    // Arrange: неактивная бронь на отменённой поездке.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("GhostDriver");
    const passengerId = await createUser("GhostPassenger");
    const tripId = await createTrip(driverId, {
      status: "cancelled",
      seatsAvailable: 3,
    });
    const bookingId = await createBooking(tripId, passengerId, 1, "cancelled");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "confirmed" }
    );

    // Assert
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TRIP_NOT_ACTIVE");
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("cancelled");
    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.seatsAvailable).toBe(3);
  });

  it("reactivation on a departed trip → 409 CONFLICT, seat not taken", async () => {
    // Arrange: активная поездка, но отправление уже прошло.
    const cookie = await loginAndGetCookie();
    const driverId = await createUser("DepartedDriver");
    const passengerId = await createUser("DepartedPassenger");
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt: new Date(Date.now() - 3600_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    createdTripIds.push(trip.id);
    const bookingId = await createBooking(trip.id, passengerId, 1, "declined");

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/bookings/${bookingId}/status`,
      cookie,
      { status: "confirmed" }
    );

    // Assert
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CONFLICT");
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("declined");
    const dbTrip = await db.trip.findUnique({ where: { id: trip.id } });
    expect(dbTrip?.seatsAvailable).toBe(3);
  });
});

describe("PATCH /admin/reviews/:id/approve|reject — concurrency", () => {
  it("concurrent approve and reject: exactly one wins, loser gets 409, rating stays consistent", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const targetUserId = await createUser("RaceTarget");
    const authorId = await createUser("RaceAuthor");
    const reviewId = await createReview(authorId, targetUserId, 5, "pending");

    // Act: оба решения летят одновременно на один pending-отзыв.
    const [approveRes, rejectRes] = await Promise.all([
      adminRequest("PATCH", `/api/v1/admin/reviews/${reviewId}/approve`, cookie),
      adminRequest("PATCH", `/api/v1/admin/reviews/${reviewId}/reject`, cookie),
    ]);

    // Assert: ровно один 200; проигравший — 409 CONFLICT, без третьего
    // статуса (частичных изменений нет).
    const statuses = [approveRes.status, rejectRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    const review = await db.review.findUnique({ where: { id: reviewId } });
    expect(review).not.toBeNull();
    expect(["published", "rejected"]).toContain(review?.status);

    // Если победил approve — рейтинг пересчитан и учитывает отзыв;
    // если reject — отзыв в рейтинг не входит (агрегат 0).
    const target = await db.user.findUnique({ where: { id: targetUserId } });
    if (review?.status === "published") {
      expect(target?.rating).toBe(5);
      expect(target?.reviewsCount).toBe(1);
    } else {
      expect(target?.reviewsCount).toBe(0);
    }
  });

  it("sequential approve then reject: second transition blocked (409)", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();
    const targetUserId = await createUser("SeqTarget");
    const authorId = await createUser("SeqAuthor");
    const reviewId = await createReview(authorId, targetUserId, 4, "pending");

    // Act
    const approve = await adminRequest(
      "PATCH",
      `/api/v1/admin/reviews/${reviewId}/approve`,
      cookie
    );
    const reject = await adminRequest(
      "PATCH",
      `/api/v1/admin/reviews/${reviewId}/reject`,
      cookie
    );

    // Assert: published не перезаписывается на rejected, рейтинг остаётся
    // согласованным с финальным статусом.
    expect(approve.status).toBe(200);
    expect(reject.status).toBe(409);
    const review = await db.review.findUnique({ where: { id: reviewId } });
    expect(review?.status).toBe("published");
    const target = await db.user.findUnique({ where: { id: targetUserId } });
    expect(target?.rating).toBe(4);
    expect(target?.reviewsCount).toBe(1);
  });
});
