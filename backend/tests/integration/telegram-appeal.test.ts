import { afterEach, describe, expect, it, vi } from "vitest";

// appealLimiter создаётся при импорте app с фиксированными значениями
// (5 запросов в час, keyPrefix "feedback-appeal"). Ключ — IP клиента.
// Включаем режим доверенного прокси (vi.hoisted — до импорта env.js/app.js)
// и задаём уникальный X-Real-IP на каждый тест (паттерн feedback-appeal.test.ts).
vi.hoisted(() => {
  process.env.TRUST_PROXY = "true";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

/**
 * POST /api/v1/feedback/appeal — TG-ветка (tg-migration-13).
 *
 * У забаненного TG-пользователя нет токена (логин 403), поэтому appeal
 * публичный: личность подтверждается raw initData (verifyTelegramInitData,
 * та же проверка что в /auth/telegram), токены не выдаются. Проверки бана
 * нет (апелляция — канал забаненного), tombstone удалённых — 403.
 * Display-поля initData (имя/аватар) на идентификацию не влияют: userId
 * резолвится только по проверенному telegramUserId.
 *
 * Паттерны репо: app.request(), AAA, уникальные telegramUserId
 * (BigInt-диапазон 9_920_000+ — не пересекается с 9_900_000+/9_910_000+),
 * dev-initData формат (hash=dev-hash, ALLOW_DEV_AUTH под vitest true),
 * чистка созданных строк в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const APPEAL_URL = "/api/v1/feedback/appeal";

const createdUserIds: string[] = [];
const createdFeedbackIds: string[] = [];
let tgSeq = 9_920_000n;
let ipSeq = 0;

function uniqueIp(): string {
  ipSeq += 1;
  return `10.9.2.${ipSeq}`;
}

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

async function seedTelegramUser(
  data: Record<string, unknown> = {},
): Promise<{ id: string; tgId: bigint }> {
  const tgId = nextTgId();
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `TgAppeal-${tgId}`,
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

function postAppeal(body: unknown, ip: string) {
  return app.request(APPEAL_URL, {
    method: "POST",
    headers: { ...JSON_HEADERS, "X-Real-IP": ip },
    body: JSON.stringify(body),
  });
}

interface AppealCreatedBody {
  id: string;
  createdAt: string;
}

interface ErrorBody {
  code?: string;
  message: string;
}

async function countFeedback(userId: string): Promise<number> {
  return db.feedback.count({ where: { userId } });
}

afterEach(async () => {
  if (createdFeedbackIds.length > 0) {
    await db.feedback.deleteMany({
      where: { id: { in: createdFeedbackIds } },
    });
    createdFeedbackIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("feedback/appeal TG-ветка: happy path и identity", () => {
  it("banned TG user + dev initData → 201, Feedback привязан к userId забаненного", async () => {
    // Arrange — забаненный: логин 403, токена нет, appeal единственный канал.
    const { id: userId, tgId } = await seedTelegramUser({
      bannedAt: new Date(),
      banReason: "Спам",
    });
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgId), first_name: "Забаненный" }),
        subject: "Обжалование блокировки",
        text: "Считаю блокировку ошибочной, прошу рассмотреть.",
      },
      ip,
    );

    // Assert
    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    expect(body.id).toBeTruthy();
    expect(new Date(body.createdAt).getTime()).not.toBeNaN();
    const stored = await db.feedback.findUnique({ where: { id: body.id } });
    expect(stored?.userId).toBe(userId);
    createdFeedbackIds.push(body.id);
  });

  it("незабаненный TG user → 201 (эндпоинт публичный, бан не обязателен)", async () => {
    const { id: userId, tgId } = await seedTelegramUser();
    const ip = uniqueIp();

    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgId), first_name: "Обычный" }),
        subject: "Вопрос",
        text: "Текст обращения.",
      },
      ip,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    expect(await countFeedback(userId)).toBe(1);
    createdFeedbackIds.push(body.id);
  });

  it("impersonation невозможен: initData пользователя A создаёт Feedback только с userId A", async () => {
    // Arrange — два TG-пользователя; атакующий шлёт СВОЮ подписанную initData,
    // но с чужим display-именем: сервер обязан привязать к проверенному id.
    const { id: userA } = await seedTelegramUser();
    const { id: userB, tgId: tgB } = await seedTelegramUser();
    const ip = uniqueIp();

    // Act — initData пользователя B (подпись валидна для B).
    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgB), first_name: "Пользователь A" }),
        subject: "Обжалование блокировки",
        text: "Пытаюсь выдать себя за другого.",
      },
      ip,
    );

    // Assert — строка принадлежит B, у A ничего не создано.
    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    const stored = await db.feedback.findUnique({ where: { id: body.id } });
    expect(stored?.userId).toBe(userB);
    expect(await countFeedback(userA)).toBe(0);
    createdFeedbackIds.push(body.id);
  });


  it("удалённый TG user → 403 Account is deleted (tombstone терминален)", async () => {
    const { tgId } = await seedTelegramUser({ deletedAt: new Date() });
    const ip = uniqueIp();
    const before = await db.feedback.count();

    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgId) }),
        subject: "Обжалование блокировки",
        text: "Попытка апелляции удалённого.",
      },
      ip,
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).message).toBe("Account is deleted");
    expect(await db.feedback.count()).toBe(before);
  });
});

describe("feedback/appeal TG-ветка: подпись и валидация", () => {
  it("невалидный hash → 401, Feedback не создаётся", async () => {
    const { id: userId, tgId } = await seedTelegramUser({ bannedAt: new Date() });
    const ip = uniqueIp();

    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgId) }, "wrong-hash"),
        subject: "Тема",
        text: "Текст",
      },
      ip,
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).message).toBe(
      "Invalid or expired signature",
    );
    expect(await countFeedback(userId)).toBe(0);
  });

  it("initData без user → 401 (dev-bypass требует валидный user.id)", async () => {
    const ip = uniqueIp();
    const before = await db.feedback.count();

    const res = await postAppeal(
      {
        initData: new URLSearchParams([["hash", "dev-hash"]]).toString(),
        subject: "Тема",
        text: "Текст",
      },
      ip,
    );

    expect(res.status).toBe(401);
    expect(await db.feedback.count()).toBe(before);
  });

  it("пустое тело → 400 VALIDATION_FAILED", async () => {
    const ip = uniqueIp();
    const before = await db.feedback.count();

    const res = await postAppeal({}, ip);

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe("VALIDATION_FAILED");
    expect(await db.feedback.count()).toBe(before);
  });

  it("initData без subject → 400 VALIDATION_FAILED", async () => {
    const { tgId } = await seedTelegramUser();
    const ip = uniqueIp();

    const res = await postAppeal(
      { initData: devInitData({ id: Number(tgId) }), text: "Текст" },
      ip,
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).code).toBe("VALIDATION_FAILED");
  });

  it("XSS в subject/text вырезается санитайзером", async () => {
    const { id: userId, tgId } = await seedTelegramUser({ bannedAt: new Date() });
    const ip = uniqueIp();

    const res = await postAppeal(
      {
        initData: devInitData({ id: Number(tgId) }),
        subject: "<script>alert(1)</script>Обжалование",
        text: "Текст <img src=x onerror=alert(1)> с разметкой",
      },
      ip,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    const stored = await db.feedback.findUnique({ where: { id: body.id } });
    expect(stored?.subject).not.toContain("<script>");
    expect(stored?.text).not.toContain("onerror");
    expect(stored?.subject).toContain("Обжалование");
    expect(await countFeedback(userId)).toBe(1);
    createdFeedbackIds.push(body.id);
  });
});

describe("feedback/appeal TG-ветка: rate limit (5 запросов в час с одного IP)", () => {
  it("6-й запрос с одного IP → 429 RATE_LIMITED", async () => {
    // Arrange — dev-bypass без replay-кэша: одно тело можно слать повторно.
    const { id: userId, tgId } = await seedTelegramUser({ bannedAt: new Date() });
    const ip = uniqueIp();
    const body = {
      initData: devInitData({ id: Number(tgId) }),
      subject: "Обжалование блокировки",
      text: "Считаю блокировку ошибочной.",
    };

    // Act — первые 5 в лимите.
    for (let i = 0; i < 5; i += 1) {
      const res = await postAppeal(body, ip);
      expect(res.status).toBe(201);
      createdFeedbackIds.push(((await res.json()) as AppealCreatedBody).id);
    }
    const sixth = await postAppeal(body, ip);

    // Assert
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as ErrorBody).code).toBe("RATE_LIMITED");
    expect(await countFeedback(userId)).toBe(5);
  });
});
