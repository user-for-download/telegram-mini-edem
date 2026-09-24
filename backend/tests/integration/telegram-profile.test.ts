import { afterEach, describe, expect, it, vi } from "vitest";

// Лимитер /auth/telegram создаётся при импорте app со значениями из env —
// поднимаем до импорта (паттерн telegram-auth.test.ts); mutation-лимитер
// DELETE-тестам не мешает (IP-бакет 30/мин, в файле 4 DELETE).
vi.hoisted(() => {
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { signAccessToken, signRefreshToken } = await import("../../src/auth/tokens.js");

/**
 * Профиль Telegram-пользователя: GET/PATCH /users/me,
 * PATCH /users/me/notification-settings, DELETE /users/me, POST /auth/logout.
 *
 * Backend-контроли общие (requireUser, getSanitizedBody,
 * profileUpdateLimiter/mutationLimiter, serializeUser): здесь проверяем их
 * на пользователях с telegramUserId — success, validation, banned, deleted
 * и active-obligation failure paths приёмки задачи 06.
 *
 * Паттерны репо: app.request(), signAccessToken для авторизации,
 * уникальные telegramUserId (BigInt-диапазон 9_910_000+, не пересекается
 * с 9_900_000+ из telegram-auth.test.ts), чистка в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
const createdTripIds: string[] = [];
const createdBookingIds: string[] = [];
let tgSeq = 9_910_000n;

function nextTgId(): bigint {
  tgSeq += 1n;
  return tgSeq;
}

async function seedTelegramUser(data: Record<string, unknown> = {}): Promise<string> {
  const tgId = nextTgId();
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `TgProfile-${tgId}`,
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function authed(method: string, path: string, token: string | null, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...JSON_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Dev-initData для проверки tombstone через реальный /auth/telegram. */
function devInitData(tgId: bigint): string {
  return new URLSearchParams([
    ["user", JSON.stringify({ id: Number(tgId), first_name: "Ghost" })],
    ["hash", "dev-hash"],
  ]).toString();
}

afterEach(async () => {
  if (createdBookingIds.length > 0) {
    await db.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    createdBookingIds.length = 0;
  }
  if (createdTripIds.length > 0) {
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    createdTripIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.rideRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.car.deleteMany({ where: { userId: { in: createdUserIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("GET /users/me (telegram)", () => {
  it("возвращает профиль telegram-пользователя (200)", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("GET", "/api/v1/users/me", token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; notificationsEnabled: boolean };
    expect(body.id).toBe(userId);
    expect(body.name).toContain("TgProfile-");
    expect(typeof body.notificationsEnabled).toBe("boolean");
  });

  it("401 без токена", async () => {
    const res = await authed("GET", "/api/v1/users/me", null);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("UNAUTHORIZED");
  });

  it("403 забаненному (Account is banned)", async () => {
    const userId = await seedTelegramUser({ bannedAt: new Date(), banReason: "Спам" });
    const token = await signAccessToken(userId);

    const res = await authed("GET", "/api/v1/users/me", token);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe("Account is banned");
  });

  it("403 удалённому (Account is deleted)", async () => {
    const userId = await seedTelegramUser({ deletedAt: new Date() });
    const token = await signAccessToken(userId);

    const res = await authed("GET", "/api/v1/users/me", token);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe("Account is deleted");
  });
});

describe("PATCH /users/me (telegram)", () => {
  it("обновляет имя и «О себе» (200, serializeUser)", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, {
      name: "Новое Имя",
      about: "Люблю дальние поездки",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; about: string };
    expect(body.id).toBe(userId);
    expect(body.name).toBe("Новое Имя");
    expect(body.about).toBe("Люблю дальние поездки");
  });

  it("400 на слишком короткое имя", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, { name: "A" });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe("Invalid payload");
  });

  it("400 на «О себе» длиннее 500 символов", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, {
      name: "Валидное Имя",
      about: "x".repeat(501),
    });

    expect(res.status).toBe(400);
  });

  it("санитизация: XSS-разметка в имени вырезается", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, {
      name: "<script>alert(1)</script>Иван",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).not.toContain("<script>");
    expect(body.name).not.toContain("alert");
    expect(body.name).toContain("Иван");
  });

  it("403 забаненному — профиль не мутируется", async () => {
    const userId = await seedTelegramUser({ bannedAt: new Date() });
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, { name: "Хакер" });

    expect(res.status).toBe(403);
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.name).toContain("TgProfile-");
  });
});

describe("PATCH /users/me/notification-settings (telegram)", () => {
  it("переключает флаг и персистит в БД", async () => {
    const userId = await seedTelegramUser({ notificationsEnabled: true });
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me/notification-settings", token, {
      notificationsEnabled: false,
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { notificationsEnabled: boolean }).notificationsEnabled).toBe(false);
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.notificationsEnabled).toBe(false);
  });

  it("400 на не-булев флаг", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me/notification-settings", token, {
      notificationsEnabled: "yes",
    });

    expect(res.status).toBe(400);
  });

  it("403 забаненному", async () => {
    const userId = await seedTelegramUser({ bannedAt: new Date() });
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me/notification-settings", token, {
      notificationsEnabled: false,
    });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /users/me (telegram)", () => {
  it("анонимизирует аккаунт; повторный вход по telegramUserId — 403 tombstone", async () => {
    const userId = await seedTelegramUser();
    const tgId = (await db.user.findUnique({ where: { id: userId }, select: { telegramUserId: true } }))!
      .telegramUserId!;
    const token = await signAccessToken(userId);

    const res = await authed("DELETE", "/api/v1/users/me", token);

    expect(res.status).toBe(200);
    const deleted = await db.user.findUnique({ where: { id: userId } });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.name).toBe("Удалённый пользователь");
    // Tombstone хранит telegramUserId — повторный вход отклоняется, дубль не создаётся
    const relogin = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ initData: devInitData(tgId) }),
    });
    expect(relogin.status).toBe(403);
    expect(((await relogin.json()) as { message: string }).message).toBe("Account is deleted");
    expect(await db.user.count({ where: { telegramUserId: tgId } })).toBe(1);
  });

  it("удаление завершает активную поездку водителя вместо 409", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);
    const trip = await db.trip.create({
      data: {
        driverId: userId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date("2030-01-01T10:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    createdTripIds.push(trip.id);

    const res = await authed("DELETE", "/api/v1/users/me", token);

    expect(res.status).toBe(200);
    const completed = await db.trip.findUnique({ where: { id: trip.id } });
    expect(completed?.status).toBe("completed");
  });

  it("удаление отменяет активную бронь; история не мешает", async () => {
    const userId = await seedTelegramUser();
    const driverId = await seedTelegramUser();
    const token = await signAccessToken(userId);
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date("2030-01-01T10:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    createdTripIds.push(trip.id);
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: userId, seat: 1, status: "confirmed" },
    });
    createdBookingIds.push(booking.id);

    const deleted = await authed("DELETE", "/api/v1/users/me", token);
    expect(deleted.status).toBe(200);
    const cancelled = await db.booking.findUnique({ where: { id: booking.id } });
    expect(cancelled?.status).toBe("cancelled");
  });

  it("бронь только на завершённой поездке (история) удалению не мешает", async () => {
    const userId = await seedTelegramUser();
    const driverId = await seedTelegramUser();
    const token = await signAccessToken(userId);
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date("2030-01-01T10:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
        status: "completed",
      },
    });
    createdTripIds.push(trip.id);
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: userId, seat: 1, status: "confirmed" },
    });
    createdBookingIds.push(booking.id);

    const allowed = await authed("DELETE", "/api/v1/users/me", token);
    expect(allowed.status).toBe(200);
  });
});

describe("POST /auth/logout (telegram)", () => {
  it("отзывает refresh-токен: последующий refresh — 401", async () => {
    const userId = await seedTelegramUser();
    const refreshToken = await signRefreshToken(userId);

    const logout = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ refreshToken }),
    });
    expect(logout.status).toBe(200);
    expect(((await logout.json()) as { success: boolean }).success).toBe(true);

    const refresh = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ refreshToken }),
    });
    expect(refresh.status).toBe(401);
  });

  it("идемпотентен без токена (200 success)", async () => {
    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
