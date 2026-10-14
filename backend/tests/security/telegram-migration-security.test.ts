import { afterEach, describe, expect, it, vi } from "vitest";

// Лимитер /auth/telegram читается при импорте: поднимаем до импорта,
// чтобы проверки границ не упирались в 429 (паттерн telegram-auth.test.ts).
// ADMIN_TOKEN — тот же паттерн: без него (CI не имеет gitignored backend/.env)
// админ-API «закрыт по умолчанию» и отвечает 403 на всё, а эти тесты
// проверяют именно 401 без/с мусорной cookie (паттерн admin-moderation.test.ts).
vi.hoisted(() => {
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
  process.env.TRUST_PROXY = "true";
  process.env.ADMIN_TOKEN = "test-admin-token-security";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

/**
 * Границы безопасности Telegram-миграции (tg-migration-18):
 * - поддельная/битая initData отвергается 401, а не 500;
 * - удалённый/забаненный не получает токены;
 * - admin-API без cookie закрыт 401;
 * - inbox отдаёт createdAt ISO-строкой (регрессия 500 из tg-migration-16).
 *
 * Паттерны репо: app.request(), реальная БД, уникальные telegramUserId
 * (BigInt 9_950_000+), чистка в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_950_000n;
let ipSeq = 0;

function nextTgId(): bigint {
  tgSeq += 1n;
  return tgSeq;
}

function uniqueIp(): string {
  ipSeq += 1;
  return `10.95.0.${ipSeq}`;
}

function initData(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params)).toString();
}

async function postTelegramLogin(body: unknown, ip = uniqueIp()) {
  return app.request("/api/v1/auth/telegram", {
    method: "POST",
    headers: { ...JSON_HEADERS, "X-Real-IP": ip },
    body: JSON.stringify(body),
  });
}

function devInitData(tgId: bigint): string {
  return initData({
    user: JSON.stringify({ id: Number(tgId), first_name: "Sec" }),
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: "dev-hash",
  });
}

async function seedTelegramUser(
  data: Record<string, unknown> = {},
): Promise<{ id: string; tgId: bigint }> {
  const tgId = nextTgId();
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `TgSec-${tgId}`,
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

afterEach(async () => {
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.refreshToken.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("POST /auth/telegram — границы подписи", () => {
  it("чужой hash → 401, без утечки деталей", async () => {
    const res = await postTelegramLogin({
      initData: devInitData(nextTgId()).replace("hash=dev-hash", "hash=forged"),
    });
    expect(res.status).toBe(401);
  });

  it("подстрока dev-hash в другом параметре не открывает bypass", async () => {
    const tgId = nextTgId();
    const res = await postTelegramLogin({
      initData: initData({
        user: JSON.stringify({ id: Number(tgId) }),
        auth_date: String(Math.floor(Date.now() / 1000)),
        hash: "nope",
        note: "hash=dev-hash",
      }),
    });
    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { telegramUserId: tgId } })).toBe(0);
  });

  it("user.id ≤ 0 или мусор → 401, пользователь не создаётся", async () => {
    const badIds = ["0", "-5", "1.5", "abc"];
    for (const id of badIds) {
      const res = await postTelegramLogin({
        initData: initData({
          user: JSON.stringify({ id }),
          auth_date: String(Math.floor(Date.now() / 1000)),
          hash: "dev-hash",
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("пустая initData → 400/401, не 500", async () => {
    const res = await postTelegramLogin({ initData: "" });
    expect([400, 401]).toContain(res.status);
  });
});

describe("POST /auth/telegram — tombstone и бан", () => {
  it("удалённый аккаунт: повторный вход 403, токенов нет", async () => {
    const { tgId } = await seedTelegramUser({ deletedAt: new Date() });
    const before = await db.refreshToken.count();
    const res = await postTelegramLogin({ initData: devInitData(tgId) });
    expect(res.status).toBe(403);
    expect(await db.refreshToken.count()).toBe(before);
  });

  it("забаненный: 403 и отзыв активных сессий", async () => {
    const { id, tgId } = await seedTelegramUser({ bannedAt: new Date() });
    await db.refreshToken.create({
      data: {
        userId: id,
        tokenHash: `sec-test-${id}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const res = await postTelegramLogin({ initData: devInitData(tgId) });
    expect(res.status).toBe(403);
    expect(
      await db.refreshToken.count({ where: { userId: id, revokedAt: null } }),
    ).toBe(0);
  });
});

describe("admin-API без сессии", () => {
  it("approve отзыва без cookie → 401", async () => {
    const res = await app.request(
      "/api/v1/admin/reviews/00000000-0000-4000-8000-000000000000/approve",
      { method: "PATCH", headers: { "X-Real-IP": uniqueIp() } },
    );
    expect(res.status).toBe(401);
  });

  it("approve с мусорной cookie → 401", async () => {
    const res = await app.request(
      "/api/v1/admin/reviews/00000000-0000-4000-8000-000000000000/approve",
      {
        method: "PATCH",
        headers: {
          "X-Real-IP": uniqueIp(),
          Cookie: "edem_admin_jwt=forged-token",
        },
      },
    );
    expect(res.status).toBe(401);
  });
});

describe("inbox — контрактная сериализация (регрессия 500)", () => {
  it("GET /notifications/my отдаёт createdAt ISO-строкой", async () => {
    const { id } = await seedTelegramUser({});
    await db.notification.create({
      data: { userId: id, type: "trip_cancelled", title: "T", body: "B" },
    });
    const { devMockAccessToken } = await import("../dev-mock-auth.js");
    const res = await app.request("/api/v1/notifications/my?limit=20", {
      headers: {
        Authorization: `Bearer ${devMockAccessToken(id)}`,
        "X-Real-IP": uniqueIp(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ createdAt: unknown }>;
    };
    expect(body.items).toHaveLength(1);
    expect(typeof body.items[0].createdAt).toBe("string");
    expect(
      Number.isNaN(Date.parse(body.items[0].createdAt as string)),
    ).toBe(false);
  });
});
