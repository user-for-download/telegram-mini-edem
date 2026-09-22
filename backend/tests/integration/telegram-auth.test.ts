import { afterEach, describe, expect, it, vi } from "vitest";

// Лимитер /auth/telegram создаётся при импорте app со значениями из env.
// Поднимаем лимит до импорта модулей, чтобы тест не упирался в 429
// (паттерн auth-concurrent-launch.test.ts).
vi.hoisted(() => {
  process.env.TG_AUTH_RATE_WINDOW_MS = "900000";
  process.env.TG_AUTH_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

/**
 * POST /api/v1/auth/telegram (dev-bypass: hash=dev-hash, токен не задан —
 * см. .env.test и telegramSign.ts). Реальная HMAC-ветка покрыта юнит-тестом
 * telegramSign.test.ts (sign() из пакета); здесь — поведение роута:
 * upsert по telegramUserId, бан/tombstone ДО токенов, синхронизация
 * профиля, P2002-гонка конкурентных запусков.
 *
 * Паттерны репо: app.request(), уникальные telegramUserId (BigInt-счётчик
 * 9_900_000+ — не пересекается с диапазонами 9_100_000/9_700_000/
 * 9_800_000 других тестов), удаление созданных юзеров в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_900_000n;

/** Свежий telegramUserId для теста. */
function nextTgId(): bigint {
  tgSeq += 1n;
  return tgSeq;
}

/** Dev-initData: user JSON + hash=dev-hash (формат dev-bypass). */
function devInitData(user: Record<string, unknown>, hash = "dev-hash"): string {
  return new URLSearchParams([
    ["user", JSON.stringify(user)],
    ["hash", hash],
  ]).toString();
}

/** Прямое создание юзера в БД (бан/tombstone-сценарии). */
async function seedUser(
  telegramUserId: bigint,
  data: Record<string, unknown> = {},
): Promise<string> {
  const user = await db.user.create({
    data: {
      telegramUserId,
      name: `TgUser-${telegramUserId}`,
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function postTelegram(initData: string) {
  return app.request("/api/v1/auth/telegram", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ initData }),
  });
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

describe("POST /auth/telegram: happy path", () => {
  it("создаёт пользователя и выдаёт токены (authResponseSchema)", async () => {
    const tgId = nextTgId();
    const res = await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Анна", last_name: "Тест" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: { id: string; name: string; isVerified: boolean };
    };
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.expiresIn).toBeGreaterThan(0);
    expect(body.user.name).toBe("Анна Тест");
    expect(body.user.isVerified).toBe(true);

    const dbUser = await db.user.findUnique({ where: { telegramUserId: tgId } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.id).toBe(body.user.id);
    createdUserIds.push(dbUser!.id);

    // Refresh-токен записан в БД (сессия живёт нашей ротацией, не initData)
    const tokenCount = await db.refreshToken.count({
      where: { userId: dbUser!.id, revokedAt: null },
    });
    expect(tokenCount).toBe(1);
  });

  it("повторный вход — тот же пользователь (upsert update-ветка)", async () => {
    const tgId = nextTgId();
    const first = await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Борис" }),
    );
    const second = await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Борис" }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { user: { id: string } };
    const secondBody = (await second.json()) as { user: { id: string } };
    expect(secondBody.user.id).toBe(firstBody.user.id);
    expect(await db.user.count({ where: { telegramUserId: tgId } })).toBe(1);
    createdUserIds.push(firstBody.user.id);
  });

  it("placeholder-имя дописывается реальным при следующем входе", async () => {
    const tgId = nextTgId();
    // Первый вход: display-данных нет → placeholder
    const first = await postTelegram(devInitData({ id: Number(tgId), first_name: "" }));
    const firstBody = (await first.json()) as { user: { id: string; name: string } };
    createdUserIds.push(firstBody.user.id);
    expect(firstBody.user.name).toBe(`Пользователь Telegram ${tgId}`);

    // Вручную имя не меняли — второй вход с first_name дописывает его
    const second = await postTelegram(devInitData({ id: Number(tgId), first_name: "Виктор" }));
    const secondBody = (await second.json()) as { user: { name: string } };
    expect(secondBody.user.name).toBe("Виктор");
  });

  it("вручную изменённое имя НЕ перезаписывается входом Telegram", async () => {
    const tgId = nextTgId();
    const first = await postTelegram(devInitData({ id: Number(tgId), first_name: "Галина" }));
    const { id } = (await first.json()).user as { id: string };
    createdUserIds.push(id);

    await db.user.update({ where: { id }, data: { name: "Своё Имя" } });

    const second = await postTelegram(devInitData({ id: Number(tgId), first_name: "Галина" }));
    const body = (await second.json()) as { user: { name: string } };
    expect(body.user.name).toBe("Своё Имя");
  });
});

describe("POST /auth/telegram: аватар", () => {
  it("принимает photo_url с t.me и синхронизирует при входе", async () => {
    const tgId = nextTgId();
    const first = await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Дима", photo_url: "https://t.me/i/userpic/320/a.svg" }),
    );
    const { id } = (await first.json()).user as { id: string };
    createdUserIds.push(id);
    const afterFirst = await db.user.findUnique({ where: { id } });
    expect(afterFirst?.avatar).toBe("https://t.me/i/userpic/320/a.svg");

    // Повторный вход с новым фото — аватар обновляется (не редактируется API)
    await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Дима", photo_url: "https://t.me/i/userpic/320/b.svg" }),
    );
    const afterSecond = await db.user.findUnique({ where: { id } });
    expect(afterSecond?.avatar).toBe("https://t.me/i/userpic/320/b.svg");
  });

  it("отклоняет аватар с чужого домена (host allowlist) → default", async () => {
    const tgId = nextTgId();
    const res = await postTelegram(
      devInitData({ id: Number(tgId), first_name: "Егор", photo_url: "https://example.com/evil.png" }),
    );
    const body = (await res.json()) as { user: { id: string } };
    createdUserIds.push(body.user.id);
    const dbUser = await db.user.findUnique({ where: { id: body.user.id } });
    expect(dbUser?.avatar).not.toBe("https://example.com/evil.png");
  });
});

describe("POST /auth/telegram: отказы", () => {
  it("401 на неверный hash", async () => {
    const res = await postTelegram(devInitData({ id: Number(nextTgId()), first_name: "X" }, "wrong-hash"));
    expect(res.status).toBe(401);
  });

  it("401 на near-miss dev-hash (подстрока)", async () => {
    const res = await postTelegram(
      devInitData({ id: Number(nextTgId()), first_name: "X" }, "dev-hash-evil"),
    );
    expect(res.status).toBe(401);
  });

  it("401 на невалидный payload (initData отсутствует)", async () => {
    const res = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("403 + banReason забаненному, активные токены отозваны", async () => {
    const tgId = nextTgId();
    const userId = await seedUser(tgId, {
      bannedAt: new Date(),
      banReason: "Спам в отзывах",
    });
    // У забаненного был активный refresh-токен — бан должен его отозвать
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash: `test-hash-${tgId}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const res = await postTelegram(devInitData({ id: Number(tgId), first_name: "Жанна" }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string; banReason: string | null };
    expect(body.message).toBe("Account is banned");
    expect(body.banReason).toBe("Спам в отзывах");
    const active = await db.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it("403 удалённому (tombstone), запись не мутируется", async () => {
    const tgId = nextTgId();
    const userId = await seedUser(tgId, { deletedAt: new Date() });

    const res = await postTelegram(devInitData({ id: Number(tgId), first_name: "Зина" }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Account is deleted");
    // Tombstone не перезаписан входом (name не стал «Зина»)
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser?.name).toBe(`TgUser-${tgId}`);
  });
});

describe("POST /auth/telegram: P2002-гонка", () => {
  it("10 конкурентных раундов: оба 200, ровно один пользователь", async () => {
    for (let i = 0; i < 10; i++) {
      const tgId = nextTgId();
      await db.user.deleteMany({ where: { telegramUserId: tgId } });

      const requests = await Promise.all(
        Array.from({ length: 2 }, () =>
          postTelegram(devInitData({ id: Number(tgId), first_name: "Race" })),
        ),
      );

      const results = await Promise.all(
        requests.map(async (response) => ({
          status: response.status,
          body: await response.text(),
        })),
      );

      if (results.some((r) => r.status !== 200)) {
        console.error(`concurrent round ${i} (${tgId}):`, results);
      }

      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await db.user.count({ where: { telegramUserId: tgId } })).toBe(1);
      const user = await db.user.findUnique({ where: { telegramUserId: tgId } });
      createdUserIds.push(user!.id);
    }
  }, 60000);
});
