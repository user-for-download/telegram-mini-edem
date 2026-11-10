import { afterEach, describe, expect, it, vi } from "vitest";
import { userSchema } from "@edem/contracts";
import { Prisma } from "../../src/generated/prisma/client.js";
import * as sanitizer from "../../src/middleware/sanitize.js";
import * as alerts from "../../src/client-errors/index.js";
import { ERROR_CODES } from "../../src/errors.js";
import { registerDevTelegramUser } from "../dev-mock-auth.js";

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5_000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pause after real auth/sanitization, before the handler's live-state check. */
function pauseBody() {
  const admitted = deferred();
  const resume = deferred();
  const original = sanitizer.getSanitizedBody;
  const spy = vi.spyOn(sanitizer, "getSanitizedBody").mockImplementationOnce(async (c) => {
    const body = await original(c);
    admitted.resolve();
    await within(resume.promise, "request release");
    return body;
  });
  return {
    wait: () => within(admitted.promise, "request admission"),
    release: resume.resolve,
    restore: () => spy.mockRestore(),
  };
}

/** Dev-initData для проверки tombstone через реальный /auth/telegram. */
function devInitData(tgId: bigint): string {
  // Bypass fail-closed (F6): id обязан быть в allowlist.
  registerDevTelegramUser(tgId);
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

  it("403 удалённому: код ACCOUNT_DELETED, а не общий FORBIDDEN бана", async () => {
    const userId = await seedTelegramUser({ deletedAt: new Date() });
    const token = await signAccessToken(userId);

    const res = await authed("GET", "/api/v1/users/me", token);

    expect(res.status).toBe(403);
    // Код машинный: клиент обязан отличать удаление от бана НЕ по тексту —
    // иначе переформулировка сообщения тихо уводит удалённого на «бан».
    // Текст остаётся прежним ради старых клиентов.
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("ACCOUNT_DELETED");
    expect(body.message).toBe("Account is deleted");
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
    const body = userSchema.parse(await res.json());
    expect(body.id).toBe(userId);
    expect(body.name).toBe("Новое Имя");
    expect(body.about).toBe("Люблю дальние поездки");
  });

  it("400 на слишком короткое имя", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, { name: "A" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "Invalid payload",
      errors: { name: { _errors: [expect.any(String)] } },
    });
  });

  it("400 на «О себе» длиннее 500 символов", async () => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, {
      name: "Валидное Имя",
      about: "x".repeat(501),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "Invalid payload",
      errors: { about: { _errors: [expect.any(String)] } },
    });
  });

  it("returns the validation code and existing details for an invalid normalized phone", async () => {
    const userId = await seedTelegramUser({ phone: "+79991112233" });
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, {
      phone: "+7 (900) 12x-45-67",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "Invalid phone format",
      errors: { phone: ["Invalid"] },
    });
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.phone).toBe("+79991112233");
  });

  it.each([
    { label: "about:null", payload: { about: null }, about: null, phone: "+79991112233", omitted: "about" },
    { label: "phone:null", payload: { phone: null }, about: "Keep about", phone: null, omitted: "phone" },
    { label: 'phone:""', payload: { phone: "" }, about: "Keep about", phone: null, omitted: "phone" },
  ])("clears $label without changing omitted fields", async ({ payload, about, phone, omitted }) => {
    const userId = await seedTelegramUser({
      name: "Keep name", about: "Keep about", phone: "+79991112233",
    });
    const token = await signAccessToken(userId);

    const res = await authed("PATCH", "/api/v1/users/me", token, payload);

    expect(res.status).toBe(200);
    const body = userSchema.parse(await res.json());
    expect(body).not.toHaveProperty(omitted);
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored).toMatchObject({ name: "Keep name", about, phone });
  });

  it("preserves disjoint name/about edits when an admitted phone-only PATCH resumes", async () => {
    const userId = await seedTelegramUser({ name: "Old name", about: "Old about" });
    const token = await signAccessToken(userId);
    const gate = pauseBody();
    const pending = Promise.resolve(authed("PATCH", "/api/v1/users/me", token, {
      phone: "+7 (900) 123-45-67",
    }));
    try {
      await gate.wait();
      const nameEdit = await authed("PATCH", "/api/v1/users/me", token, { name: "New name" });
      expect(nameEdit.status).toBe(200);
      const aboutEdit = await authed("PATCH", "/api/v1/users/me", token, { about: "New about" });
      expect(aboutEdit.status).toBe(200);

      gate.release();
      const res = await pending;
      expect(res.status).toBe(200);
      const expected = { name: "New name", about: "New about", phone: "+79001234567" };
      expect(userSchema.parse(await res.json())).toMatchObject(expected);
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject(expected);
    } finally {
      gate.release();
      await Promise.allSettled([pending]);
      gate.restore();
    }
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

describe("profile/settings writes with stale auth", () => {
  it.each(["/api/v1/users/me", "/api/v1/users/me/notification-settings"])(
    "empty PATCH %s returns fresh DB values without any write or updatedAt bump",
    async (path) => {
      const userId = await seedTelegramUser({
        name: "Old name", about: "Old about", phone: "+79000000001", notificationsEnabled: true,
      });
      const token = await signAccessToken(userId);
      const writes = vi.spyOn(db.user, "update");
      const transactions = vi.spyOn(db, "$transaction");
      const gate = pauseBody();
      const pending = Promise.resolve(authed("PATCH", path, token, {}));
      try {
        await gate.wait();
        const current = await db.user.update({
          where: { id: userId },
          data: {
            name: "Fresh name", about: "Fresh about", phone: "+79000000002",
            avatar: "https://t.me/i/userpic/320/fresh.svg", notificationsEnabled: false,
            // A fixed sentinel makes an accidental write observable without sleeps.
            updatedAt: new Date("2020-01-01T00:00:00Z"),
          },
          include: { car: true },
        });
        writes.mockClear();

        gate.release();
        const res = await pending;
        expect(res.status).toBe(200);
        expect(userSchema.parse(await res.json())).toMatchObject({
          name: current.name, about: current.about, phone: current.phone,
          avatar: current.avatar, notificationsEnabled: current.notificationsEnabled,
        });
        expect(writes).not.toHaveBeenCalled();
        expect(transactions).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
        expect(await db.user.findUniqueOrThrow({ where: { id: userId }, include: { car: true } })).toEqual(current);
      } finally {
        gate.release();
        await Promise.allSettled([pending]);
        gate.restore();
        writes.mockRestore();
        transactions.mockRestore();
      }
    },
  );

  it.each([
    { path: "/api/v1/users/me", payload: { phone: "+79001234567" }, banReason: "Profile ban" },
    { path: "/api/v1/users/me/notification-settings", payload: { notificationsEnabled: false }, banReason: null },
  ])("rejects an admitted PATCH $path after a ban, including banReason", async ({ path, payload, banReason }) => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);
    const gate = pauseBody();
    const pending = Promise.resolve(authed("PATCH", path, token, payload));
    try {
      await gate.wait();
      const banned = await db.user.update({
        where: { id: userId }, data: { bannedAt: new Date(), banReason },
      });
      gate.release();
      const res = await pending;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: ERROR_CODES.FORBIDDEN, message: "Account is banned", banReason,
      });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(banned);
    } finally {
      gate.release();
      await Promise.allSettled([pending]);
      gate.restore();
    }
  });

  it.each([
    {
      label: "infrastructure failure", path: "/api/v1/users/me", payload: { phone: "+79001234567" },
      error: new Error("Live account lookup unavailable"), status: 500,
      response: { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error" },
    },
    {
      label: "serialization conflict", path: "/api/v1/users/me/notification-settings", payload: { notificationsEnabled: false },
      error: new Prisma.PrismaClientKnownRequestError("Profile write conflict", {
        code: "P2034", clientVersion: Prisma.prismaVersion.client,
      }),
      status: 409,
      response: { code: ERROR_CODES.CONFLICT, message: "Concurrent update conflict, please retry", retryable: true },
    },
  ])("lets $label reach the global mapper without changing the user", async ({ path, payload, error, status, response }) => {
    const userId = await seedTelegramUser();
    const token = await signAccessToken(userId);
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const transaction = vi.spyOn(db, "$transaction").mockRejectedValueOnce(error);
    const report = vi.spyOn(alerts, "reportServerError").mockImplementation(() => undefined);
    try {
      const res = await authed("PATCH", path, token, payload);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(response);
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(before);
    } finally {
      transaction.mockRestore();
      report.mockRestore();
    }
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
