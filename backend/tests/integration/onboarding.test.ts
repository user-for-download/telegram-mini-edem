import { afterEach, describe, expect, it, vi } from "vitest";
import { userSchema } from "@edem/contracts";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { DEFAULT_AVATAR_URL } from "../../src/constants.js";
import { ACCOUNT_DELETED_MESSAGE, ERROR_CODES } from "../../src/errors.js";
import * as sanitizer from "../../src/middleware/sanitize.js";

// ADMIN_TOKEN и лимиты (логин админки, мутации) читаются из env при импорте.
// Задаём до импорта app; лимиты завышаем, чтобы тест не упёрся в 429.
vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-123";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.MUTATION_RATE_WINDOW_MS = "60000";
  process.env.MUTATION_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { signAccessToken } = await import("../../src/auth/tokens.js");

/**
 * Онбординг-флаг: завершение онбординга пользователем и админ-сброс.
 *
 * 1) POST /users/me/onboarding — сохраняет версию показанных слайдов в
 *    User.onboardingVersion (requireUser + mutationLimiter, тело {version}:
 *    строка 1..50 символов после trim; иначе 400 "Invalid payload").
 *
 * 2) PATCH /admin/users/:id/onboarding-reset — обнуляет флаг (admin guard,
 *    404 для несуществующего пользователя, идемпотентно), чтобы пользователь
 *    снова увидел слайды при следующем запуске.
 *
 * Паттерны репо (см. ban-enforcement.test.ts, admin-moderation.test.ts):
 * app.request(), логин админки через POST /admin/auth/login с cookie
 * edem_admin_jwt, уникальные telegramUserId (INT4-счётчик).
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-123";

const createdUserIds: string[] = [];
// telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
// Диапазон не пересекается с другими интеграционными тестами (они идут
// параллельно в одну БД): 9_300_000.
let tgSeq = 9_300_000n;

async function createUser(options: { onboardingVersion?: string } = {}): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `OnboardingUser-${tgSeq + 1n}`,
      telegramUserId: ++tgSeq,
      avatar: "https://i.pravatar.cc/200?img=10",
      ...(options.onboardingVersion !== undefined
        ? { onboardingVersion: options.onboardingVersion }
        : {}),
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function postOnboarding(token: string | null, body: unknown) {
  return app.request("/api/v1/users/me/onboarding", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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

function adminRequest(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...JSON_HEADERS, Cookie: `edem_admin_jwt=${cookie}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("POST /users/me/onboarding — completion", () => {
  it("persists a valid version (200, version and consent timestamp in response and DB)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, { version: "1" });

    // Assert
    expect(res.status).toBe(200);
    const body = userSchema.parse(await res.json());
    expect(body.id).toBe(userId);
    expect(body.onboardingVersion).toBe("1");
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.onboardingVersion).toBe("1");
    // Момент акцепта (152-ФЗ ст. 9): проставлен, недавний.
    expect(dbUser?.consentAcceptedAt).not.toBeNull();
    expect(
      Date.now() - (dbUser?.consentAcceptedAt?.getTime() ?? 0),
    ).toBeLessThan(60_000);
  });

  it("accepts a version of exactly 50 characters (boundary)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);
    const version = "a".repeat(50);

    // Act
    const res = await postOnboarding(token, { version });

    // Assert
    expect(res.status).toBe(200);
    const body = userSchema.parse(await res.json());
    expect(body.onboardingVersion).toBe(version);
  });

  it("rejects admitted onboarding after real deletion commits without restoring PII or legal consent", async () => {
    const userId = await createUser({ onboardingVersion: "1" });
    await db.user.update({
      where: { id: userId },
      data: { about: "Original about", phone: "+79001234567", consentAcceptedAt: new Date("2026-01-01T00:00:00Z") },
    });
    const token = await signAccessToken(userId);
    const gate = pauseBody();
    const pending = Promise.resolve(postOnboarding(token, { version: "2" }));
    try {
      await gate.wait();
      const deletion = await app.request("/api/v1/users/me", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      expect(deletion.status).toBe(200);
      const deleted = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(deleted).toMatchObject({
        deletedAt: expect.any(Date), name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL,
        about: null, phone: null, onboardingVersion: null, consentAcceptedAt: null,
      });

      gate.release();
      const res = await pending;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: ERROR_CODES.ACCOUNT_DELETED, message: ACCOUNT_DELETED_MESSAGE });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(deleted);
    } finally {
      gate.release();
      await Promise.allSettled([pending]);
      gate.restore();
    }
  });

  it("rolls back an overlapping onboarding transaction when deletion wins", async () => {
    const userId = await createUser({ onboardingVersion: "1" });
    await db.user.update({
      where: { id: userId }, data: { phone: "+79001234567", consentAcceptedAt: new Date("2026-01-01T00:00:00Z") },
    });
    const token = await signAccessToken(userId);
    const admitted = deferred();
    const resume = deferred();
    const original = db.$transaction.bind(db);
    const transaction = vi.spyOn(db, "$transaction").mockImplementationOnce(
      <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Parameters<typeof db.$transaction>[1]): Promise<T> =>
        original(async (tx) => {
          // Establish a real live snapshot, then execute the route's unchanged callback.
          await tx.user.findUniqueOrThrow({ where: { id: userId } });
          admitted.resolve();
          await within(resume.promise, "onboarding transaction release");
          return run(tx);
        }, { ...options, timeout: 15_000 }),
    );
    const pending = Promise.resolve(postOnboarding(token, { version: "2" }));
    try {
      await within(admitted.promise, "onboarding transaction snapshot");
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      const deletion = await app.request("/api/v1/users/me", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      expect(deletion.status).toBe(200);
      const deleted = await db.user.findUniqueOrThrow({ where: { id: userId } });

      resume.resolve();
      const res = await pending;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: ERROR_CODES.CONFLICT, message: "Concurrent update conflict, please retry", retryable: true,
      });
      expect(deleted).toMatchObject({
        deletedAt: expect.any(Date), name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL,
        about: null, phone: null, onboardingVersion: null, consentAcceptedAt: null,
      });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(deleted);
    } finally {
      resume.resolve();
      await Promise.allSettled([pending]);
      transaction.mockRestore();
    }
  });

  it("rejects admitted onboarding after a ban with banReason and no consent/version write", async () => {
    const userId = await createUser({ onboardingVersion: "1" });
    const token = await signAccessToken(userId);
    const gate = pauseBody();
    const pending = Promise.resolve(postOnboarding(token, { version: "2" }));
    try {
      await gate.wait();
      const banned = await db.user.update({
        where: { id: userId }, data: { bannedAt: new Date(), banReason: "Onboarding ban" },
      });
      gate.release();
      const res = await pending;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: ERROR_CODES.FORBIDDEN, message: "Account is banned", banReason: "Onboarding ban",
      });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(banned);
    } finally {
      gate.release();
      await Promise.allSettled([pending]);
      gate.restore();
    }
  });

  it("requires auth: 401 without a token", async () => {
    // Arrange — пользователь есть, но токена нет.
    await createUser();

    // Act
    const res = await postOnboarding(null, { version: "1" });

    // Assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("rejects an empty version (400)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, { version: "" });

    // Assert
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid payload");
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.onboardingVersion).toBeNull();
  });

  it("rejects a whitespace-only version (400, trim before min-length)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, { version: "   " });

    // Assert
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid payload");
  });

  it("rejects a version longer than 50 characters (400)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, { version: "a".repeat(51) });

    // Assert
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid payload");
  });

  it("rejects a missing version (400)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, {});

    // Assert
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid payload");
  });

  it("rejects a non-string version (400)", async () => {
    // Arrange
    const userId = await createUser();
    const token = await signAccessToken(userId);

    // Act
    const res = await postOnboarding(token, { version: 1 });

    // Assert
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid payload");
  });
});

describe("PATCH /admin/users/:id/onboarding-reset — admin reset", () => {
  it("nulls onboardingVersion and consent timestamp of a user with a completed onboarding (200 + DB nulls)", async () => {
    // Arrange — пользователь с пройденным онбордингом и акцептом.
    const cookie = await loginAndGetCookie();
    const userId = await createUser({ onboardingVersion: "1" });
    await db.user.update({
      where: { id: userId },
      data: { consentAcceptedAt: new Date() },
    });

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/users/${userId}/onboarding-reset`,
      cookie
    );

    // Assert — флаг и момент акцепта обнулены в БД; ответ — обновлённый admin user DTO.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; bannedAt: string | null };
    expect(body.id).toBe(userId);
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.onboardingVersion).toBeNull();
    expect(dbUser?.consentAcceptedAt).toBeNull();
  });

  it("is idempotent: resetting an already-null flag returns the user (200)", async () => {
    // Arrange — флаг никогда не устанавливался.
    const cookie = await loginAndGetCookie();
    const userId = await createUser();

    // Act
    const res = await adminRequest(
      "PATCH",
      `/api/v1/admin/users/${userId}/onboarding-reset`,
      cookie
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(userId);
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.onboardingVersion).toBeNull();
    expect(dbUser?.consentAcceptedAt).toBeNull();
  });

  it("requires an admin session: 401 without the cookie", async () => {
    // Arrange
    const userId = await createUser({ onboardingVersion: "1" });

    // Act
    const res = await app.request(`/api/v1/admin/users/${userId}/onboarding-reset`, {
      method: "PATCH",
      headers: JSON_HEADERS,
    });

    // Assert — флаг не тронут.
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.onboardingVersion).toBe("1");
  });

  it("returns 404 for a missing user", async () => {
    // Arrange
    const cookie = await loginAndGetCookie();

    // Act
    const res = await adminRequest(
      "PATCH",
      "/api/v1/admin/users/00000000-0000-0000-0000-000000000000/onboarding-reset",
      cookie
    );

    // Assert
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });
});
