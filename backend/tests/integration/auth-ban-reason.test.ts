import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDevTelegramUser } from "../dev-mock-auth.js";

// Лимитер /auth/refresh создаётся при импорте app со значениями из env.
// Поднимаем лимит до импорта модулей, чтобы тест не упирался в 429.
vi.hoisted(() => {
  process.env.REFRESH_RATE_WINDOW_MS = "900000";
  process.env.REFRESH_RATE_MAX = "1000";
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { signRefreshToken } = await import("../../src/auth/tokens.js");
const { devMockRefreshToken } = await import("../dev-mock-auth.js");

/**
 * Регрессия: «причина бана» в auth-слое.
 *
 * До расширения функциональности /auth/telegram не проверял бан и выдавал токены
 * забаненному пользователю, а /auth/refresh отдавал 403 без указания причины.
 * Теперь:
 *  1) /auth/telegram отказывает забаненному ДО выпуска токенов, отвечает 403
 *     с body.code === "FORBIDDEN" и body.banReason, отзывает все активные
 *     refresh-токены пользователя.
 *  2) /auth/refresh (обе ветки: dev-mock и main) симметрично возвращает
 *     403 + banReason.
 *  3) Старые баны (bannedAt без banReason) → banReason: null — клиент
 *     показывает «Причина не указана».
 *
 * Паттерны репо (см. ban-enforcement.test.ts, telegram-auth.test.ts):
 * app.request() вместо supertest, уникальные telegramUserId, fake-WS не нужны.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
// telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
// Диапазон 9_300_000+ не пересекается с другими интеграционными тестами.
let tgSeq = 9_300_000n;

interface CreateBannedUserOptions {
  reason: string | null;
}

interface CreatedUser {
  id: string;
  telegramUserId: bigint;
}

async function createBannedUser(
  options: CreateBannedUserOptions
): Promise<CreatedUser> {
  const telegramUserId = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `BanReasonUser-${telegramUserId}`,
      telegramUserId,
      avatar: "https://i.pravatar.cc/200?img=10",
      bannedAt: new Date(),
      // Prisma-уровень: null = legacy бан без причины. Подкрепляем сценарий
      // существующих в БД записей, забаненных до миграции add_user_ban_reason.
      banReason: options.reason,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, telegramUserId: user.telegramUserId };
}

async function createActiveUser(): Promise<CreatedUser> {
  const telegramUserId = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `BanReasonUser-Active-${telegramUserId}`,
      telegramUserId,
      avatar: "https://i.pravatar.cc/200?img=10",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, telegramUserId: user.telegramUserId };
}

function devInitData(telegramUserId: bigint): string {
  // Dev-bypass TG: hash=dev-hash. verifyTelegramInitData в dev-режиме
  // (ALLOW_DEV_AUTH=true) принимает такое initData без проверки HMAC.
  //
  // Bypass fail-closed (F6): принимает только id из allowlist, поэтому
  // каждый вызов регистрирует свой id — иначе тест молча уходит в 401.
  registerDevTelegramUser(telegramUserId);
  return new URLSearchParams([
    ["user", JSON.stringify({ id: Number(telegramUserId), first_name: "Ban" })],
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["hash", "dev-hash"],
  ]).toString();
}

async function postTelegramLogin(telegramUserId: bigint) {
  return app.request("/api/v1/auth/telegram", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ initData: devInitData(telegramUserId) }),
  });
}

async function postRefresh(refreshToken: string) {
  return app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken }),
  });
}

async function countActiveTokens(userId: string): Promise<number> {
  return db.refreshToken.count({ where: { userId, revokedAt: null } });
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.refreshToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("auth/telegram: banned user rejected with banReason", () => {
  it("banned user with reason → 403 FORBIDDEN, no tokens issued, tokens revoked", async () => {
    // Arrange — пользователь с активной причиной бана.
    const reason = "Спам в чатах";
    const { id: userId, telegramUserId } = await createBannedUser({ reason });
    // Создаём «прошлую» активную сессию, чтобы убедиться, что /auth/telegram
    // отзывает все ранее выданные токены.
    await signRefreshToken(userId);
    await signRefreshToken(userId);
    expect(await countActiveTokens(userId)).toBe(2);

    // Act
    const res = await postTelegramLogin(telegramUserId);

    // Assert — 403 с кодом, причиной и без выпуска токенов.
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      message: string;
      banReason: string | null;
      accessToken?: string;
      refreshToken?: string;
      user?: unknown;
    };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toBeTruthy();
    expect(body.banReason).toBe(reason);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toBeUndefined();

    // Все активные refresh-токены пользователя отозваны в /auth/telegram.
    expect(await countActiveTokens(userId)).toBe(0);
  });

  it("legacy banned user (bannedAt set, banReason null) → 403 with banReason: null", async () => {
    // Arrange — пользователь забанен до миграции add_user_ban_reason:
    // bannedAt есть, banReason остался null. Клиент трактует null как
    // «Причина не указана» (см. ТЗ ban-reason-screen).
    const { telegramUserId } = await createBannedUser({ reason: null });

    // Act
    const res = await postTelegramLogin(telegramUserId);

    // Assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; banReason: string | null };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBeNull();
  });

  it("non-banned user with same telegramUserId still receives tokens (sanity)", async () => {
    // Arrange — обычный (не забаненный) пользователь: убеждаемся, что 403
    // наблюдается именно из-за бана, а не из-за побочных эффектов dev-логина.
    const { telegramUserId } = await createActiveUser();

    // Act
    const res = await postTelegramLogin(telegramUserId);

    // Assert — 200, токены выданы.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });
});

describe("auth/telegram: ban check revokes pre-existing active sessions", () => {
  it("pre-existing refresh tokens are revoked when /auth/telegram detects ban", async () => {
    // Arrange — обычный пользователь с двумя активными сессиями (две записи
    // в RefreshToken). Затем он банится (имитируем «бан между сессиями»:
    // обновляем bannedAt/banReason напрямую в БД, как если бы это сделала
    // админ-панель ранее). Фокус теста — поведение /auth/telegram: при бане
    // активные токены должны быть отозваны revokeAllActiveTokens, чтобы
    // бан нельзя было обойти через другую сессию.
    const reason = "Нарушение правил сервиса";
    const { id: userId, telegramUserId } = await createActiveUser();
    const oldToken = await signRefreshToken(userId);
    await signRefreshToken(userId);
    expect(await countActiveTokens(userId)).toBe(2);
    await db.user.update({
      where: { id: userId },
      data: { bannedAt: new Date(), banReason: reason },
    });

    // Act
    const res = await postTelegramLogin(telegramUserId);

    // Assert — обе активные сессии отозваны, старый токен больше невалиден.
    expect(res.status).toBe(403);
    expect(await countActiveTokens(userId)).toBe(0);

    // Старый токен тоже не должен проходить: при ротации БД-чек находит
    // revokedAt и бросает RefreshTokenRevokedError → 401.
    const refreshRes = await postRefresh(oldToken);
    expect(refreshRes.status).toBe(401);
  });
});

describe("auth/refresh: banned user rejected with banReason (main branch)", () => {
  it("banned user with valid refresh token → 403 FORBIDDEN + banReason", async () => {
    // Arrange — обычный refresh-токен (main-ветка, не dev-mock).
    const reason = "Мошенничество";
    const { id: userId } = await createBannedUser({ reason });
    const refreshToken = await signRefreshToken(userId);

    // Act
    const res = await postRefresh(refreshToken);

    // Assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      banReason: string | null;
      accessToken?: string;
      refreshToken?: string;
    };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBe(reason);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  it("legacy banned user via /auth/refresh → 403 with banReason: null", async () => {
    // Arrange
    const { id: userId } = await createBannedUser({ reason: null });
    const refreshToken = await signRefreshToken(userId);

    // Act
    const res = await postRefresh(refreshToken);

    // Assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; banReason: string | null };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBeNull();
  });

  it("banned user via /auth/refresh: tokens revoked, no new tokens issued", async () => {
    // Arrange — несколько активных сессий: revokeAllActiveTokens должен
    // обнулить их все.
    const reason = "Спам";
    const { id: userId } = await createBannedUser({ reason });
    const firstToken = await signRefreshToken(userId);
    await signRefreshToken(userId);
    expect(await countActiveTokens(userId)).toBe(2);

    // Act
    const res = await postRefresh(firstToken);

    // Assert — 403, активные токены обнулены, новых токенов в ответе нет.
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      banReason: string | null;
      accessToken?: string;
      refreshToken?: string;
    };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBe(reason);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(await countActiveTokens(userId)).toBe(0);
  });
});

describe("auth/refresh: banned user rejected with banReason (dev-mock branch)", () => {
  it("banned user with mock refresh token → 403 FORBIDDEN + banReason", async () => {
    // Arrange — dev-mock refresh-токен (tests/dev-mock-auth.js:
    // allowlist + exp). Эта ветка активна только при env.ALLOW_DEV_AUTH === true; в vitest
    // это условие выполняется всегда (см. env.ts: `if (process.env.VITEST) return true`).
    const reason = "Обход правил";
    const { id: userId } = await createBannedUser({ reason });
    const mockRefresh = devMockRefreshToken(userId);

    // Act
    const res = await postRefresh(mockRefresh);

    // Assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      banReason: string | null;
      accessToken?: string;
      refreshToken?: string;
    };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBe(reason);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  it("legacy banned user via mock refresh → 403 with banReason: null", async () => {
    // Arrange
    const { id: userId } = await createBannedUser({ reason: null });
    const mockRefresh = devMockRefreshToken(userId);

    // Act
    const res = await postRefresh(mockRefresh);

    // Assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; banReason: string | null };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.banReason).toBeNull();
  });

  it("non-banned user with mock refresh still rotates (sanity for dev-mock branch)", async () => {
    // Arrange — обычный пользователь с dev-mock refresh токеном.
    const { id: userId } = await createActiveUser();

    // Act
    const res = await postRefresh(devMockRefreshToken(userId));

    // Assert — 200, токены выданы (dev-mock ветка не срабатывает на бане).
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });
});
