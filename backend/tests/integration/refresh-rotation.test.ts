import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

// Лимитер /auth/refresh создаётся при импорте app со значениями из env.
// Поднимаем лимит до импорта модулей, чтобы тест не упирался в 429.
vi.hoisted(() => {
  process.env.REFRESH_RATE_WINDOW_MS = "900000";
  process.env.REFRESH_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { signRefreshToken, hashToken, rotateRefreshToken, RefreshTokenRevokedError } =
  await import("../../src/auth/tokens.js");

/**
 * Ротация refresh-токенов: атомарность и reuse detection.
 *
 * Регрессия TOCTOU-гонки: до исправления rotateRefreshToken читал revokedAt
 * и затем обновлял строку отдельными операциями под Read Committed — две
 * параллельные ротации одного токена обе проходили проверку и выдавали по
 * новому активному токену. Теперь отзыв — один UPDATE с предикатом
 * `revokedAt IS NULL`: из N конкурентов ровно один получает count === 1.
 *
 * Reuse detection: предъявление уже ротированного токена на /auth/refresh
 * отзывает ВСЕ активные токены пользователя (token family revocation).
 * Повторный /auth/logout тем же токеном семью НЕ отзывает.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];

async function createUser(seq: number): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `RefreshUser-${seq}`,
      telegramUserId: BigInt(3_300_000 + seq),
      avatar: "https://i.pravatar.cc/200?img=7",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

function getJti(token: string): string {
  const jti = decodeJwt(token).jti;
  if (typeof jti !== "string") {
    throw new Error("refresh token has no jti");
  }
  return jti;
}

async function postRefresh(refreshToken: string) {
  return app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken }),
  });
}

async function postLogout(refreshToken: string) {
  return app.request("/api/v1/auth/logout", {
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

describe("refresh token rotation", () => {
  it("concurrent rotations of one token mint exactly one successor", async () => {
    const userId = await createUser(1);

    for (let round = 0; round < 5; round++) {
      const token = await signRefreshToken(userId);
      const jti = getJti(token);

      const [first, second] = await Promise.allSettled([
        postRefresh(token),
        postRefresh(token),
      ]);

      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled");
      if (first.status !== "fulfilled" || second.status !== "fulfilled") return;

      const statuses = [first.value.status, second.value.status].sort();
      // Регрессия #1: ровно одна ротация успешна. До исправления обе могли
      // вернуть 200 и выдать два активных токена (TOCTOU под Read Committed).
      expect(statuses).toEqual([200, 401]);

      // Старый токен всегда отозван.
      const oldRow = await db.refreshToken.findUnique({
        where: { tokenHash: hashToken(jti) },
      });
      expect(oldRow?.revokedAt).not.toBeNull();

      // Проигравший обязан попасть в reuse detection и отозвать семью:
      // после H2 rotateRefreshToken бросает RefreshTokenRevokedError и на
      // конкурентной ротации, поэтому активных токенов остаётся 0.
      expect(await countActiveTokens(userId)).toBe(0);

      // Следующий раунд стартует с единственным активным токеном.
      await db.refreshToken.deleteMany({ where: { userId } });
    }
  });

  it("replaying a rotated token revokes the whole token family", async () => {
    const userId = await createUser(2);
    const oldToken = await signRefreshToken(userId);

    const rotateRes = await postRefresh(oldToken);
    expect(rotateRes.status).toBe(200);
    const { refreshToken: newToken } = (await rotateRes.json()) as {
      refreshToken: string;
    };
    expect(await countActiveTokens(userId)).toBe(1);

    // Reuse старого токена: 401 + отзыв всей семьи (включая новый токен).
    const reuseRes = await postRefresh(oldToken);
    expect(reuseRes.status).toBe(401);
    expect(await countActiveTokens(userId)).toBe(0);

    const newTokenRes = await postRefresh(newToken);
    expect(newTokenRes.status).toBe(401);
  });

  it("rotation issues a new pair and invalidates the old token (old reuse rejected)", async () => {
    // Arrange
    const userId = await createUser(4);
    const oldToken = await signRefreshToken(userId);
    const oldJti = getJti(oldToken);

    // Act
    const rotateRes = await postRefresh(oldToken);

    // Assert — выдана новая пара, старый токен недействителен
    expect(rotateRes.status).toBe(200);
    const { accessToken, refreshToken: newToken } = (await rotateRes.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(typeof accessToken).toBe("string");
    expect(newToken).not.toBe(oldToken);
    expect(getJti(newToken)).not.toBe(oldJti);
    expect(await countActiveTokens(userId)).toBe(1);

    expect((await postRefresh(oldToken)).status).toBe(401);
  });

  it("rejects a refresh token whose DB row belongs to a different user (userId binding)", async () => {
    // Arrange — запись в БД принадлежит userB, подписанный sub JWT — userA
    const userA = await createUser(5);
    const userB = await createUser(6);
    const token = await signRefreshToken(userA);
    const jti = getJti(token);
    await db.refreshToken.update({
      where: { tokenHash: hashToken(jti) },
      data: { userId: userB },
    });

    // Act
    const res = await postRefresh(token);

    // Assert — 401 без оракула и без отзыва чужой семьи токенов
    expect(res.status).toBe(401);
    expect(await countActiveTokens(userB)).toBe(1);
  });

  it("rotateRefreshToken with a mismatched userId revokes nothing and mints nothing", async () => {
    // Arrange
    const userA = await createUser(7);
    const userB = await createUser(8);
    const token = await signRefreshToken(userA);
    const jti = getJti(token);

    // Act / Assert — предикат (tokenHash, userId) не сошёлся: count === 0.
    // Прямой вызов не ловит ошибку, поэтому отзыва нет; в роуте /refresh
    // этот класс означает reuse и отзывает семью.
    await expect(rotateRefreshToken(jti, userB)).rejects.toBeInstanceOf(
      RefreshTokenRevokedError,
    );

    const oldRow = await db.refreshToken.findUnique({
      where: { tokenHash: hashToken(jti) },
    });
    expect(oldRow?.revokedAt).toBeNull();
    expect(oldRow?.userId).toBe(userA);
    expect(await countActiveTokens(userA)).toBe(1);
    expect(await countActiveTokens(userB)).toBe(0);
  });

  it("double logout does not revoke the token family", async () => {
    const userId = await createUser(3);
    const oldToken = await signRefreshToken(userId);

    const rotateRes = await postRefresh(oldToken);
    expect(rotateRes.status).toBe(200);
    const { refreshToken: newToken } = (await rotateRes.json()) as {
      refreshToken: string;
    };

    // Повторный logout старым токеном безопасен и не трогает новую сессию.
    expect((await postLogout(oldToken)).status).toBe(200);
    expect((await postLogout(oldToken)).status).toBe(200);
    expect(await countActiveTokens(userId)).toBe(1);

    expect((await postRefresh(newToken)).status).toBe(200);
  });
});
