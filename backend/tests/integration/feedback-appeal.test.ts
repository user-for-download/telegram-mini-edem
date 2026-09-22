import { afterEach, describe, expect, it, vi } from "vitest";

// appealLimiter создаётся при импорте app с фиксированными значениями
// (5 запросов в час, keyPrefix "feedback-appeal") и через ENV не
// настраивается. Ключ лимитера — IP клиента (rateLimit.ts). В транспорте
// app.request() нет TCP-сокета, поэтому без TRUST_PROXY все запросы
// получают IP "unknown" и общий bucket: жёсткий лимит 5/час загрязнял бы
// соседние тесты в этом файле. Включаем режим доверенного прокси
// (vi.hoisted — до импорта env.js/app.js) и задаём уникальный X-Real-IP
// на каждый тест.
vi.hoisted(() => {
  process.env.TRUST_PROXY = "true";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
  FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH,
} = await import("@edem/contracts");

/**
 * POST /api/v1/feedback/appeal — обращение ЗАБАНЕННОГО пользователя
 * (только TG-ветка).
 *
 * У забаненного нет токена (логин отклоняется 403), поэтому эндпоинт
 * публичный: личность подтверждается подписью Telegram initData
 * (verifyTelegramInitData, та же, что в /auth/telegram), токены не выдаются.
 * Лимитер 5/час по IP стоит ДО обработки запроса.
 *
 * Паттерны репо: app.request() вместо supertest, AAA, уникальные
 * telegramUserId (BigInt-счётчик), очистка созданных строк в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const APPEAL_URL = "/api/v1/feedback/appeal";

const createdUserIds: string[] = [];
const createdFeedbackIds: string[] = [];
// telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
// Диапазон 9_500_000+ не пересекается с другими интеграционными тестами.
let tgSeq = 9_500_000n;
// Уникальный IP клиента на тест: лимитер ключит bucket'и по IP
// (TRUST_PROXY=true → X-Real-IP доверенный, см. rateLimit.ts).
let ipSeq = 0;

function uniqueIp(): string {
  ipSeq += 1;
  return `10.9.5.${ipSeq}`;
}

interface CreatedUser {
  id: string;
  telegramUserId: bigint;
}

async function createUser(
  options: { banned?: boolean; banReason?: string | null } = {}
): Promise<CreatedUser> {
  const telegramUserId = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `AppealUser-${telegramUserId}`,
      telegramUserId,
      avatar: "https://i.pravatar.cc/200?img=12",
      ...(options.banned
        ? { bannedAt: new Date(), banReason: options.banReason ?? "Спам" }
        : {}),
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, telegramUserId };
}

/** Dev-initData формата dev-bypass (hash=dev-hash, ALLOW_DEV_AUTH под vitest). */
function devInitData(
  telegramUserId: bigint,
  hash = "dev-hash"
): string {
  return new URLSearchParams([
    ["user", JSON.stringify({ id: Number(telegramUserId), first_name: "Appeal" })],
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["hash", hash],
  ]).toString();
}

function postAppeal(body: unknown, ip: string) {
  return app.request(APPEAL_URL, {
    method: "POST",
    headers: { ...JSON_HEADERS, "X-Real-IP": ip },
    body: JSON.stringify(body),
  });
}

function validAppealBody(telegramUserId: bigint) {
  return {
    initData: devInitData(telegramUserId),
    subject: "Обжалование блокировки",
    text: "Считаю блокировку ошибочной, прошу рассмотреть обращение.",
  };
}

async function countFeedback(userId: string): Promise<number> {
  return db.feedback.count({ where: { userId } });
}

interface AppealCreatedBody {
  id: string;
  createdAt: string;
}

interface ErrorBody {
  code?: string;
  message: string;
}

interface ValidationFailedBody {
  code: string;
  message: string;
  issues: unknown[];
}

/** Общий assert для 400 VALIDATION_FAILED (форма ошибки feedback/index.ts). */
async function expectValidationFailed(
  res: Response,
  fieldHint?: string
): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as ValidationFailedBody;
  expect(body.code).toBe("VALIDATION_FAILED");
  expect(body.message).toBe("Invalid feedback payload");
  expect(Array.isArray(body.issues)).toBe(true);
  expect(body.issues.length).toBeGreaterThan(0);
  if (fieldHint) {
    expect(JSON.stringify(body.issues)).toContain(fieldHint);
  }
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

describe("feedback/appeal: подпись TG и резолв пользователя", () => {
  it("valid initData + BANNED user → 201, Feedback создан с userId забаненного", async () => {
    // Arrange — забаненный пользователь: логин отклоняется 403, токена нет,
    // appeal для него — единственный канал связи (бан не блокирует обращение).
    const { id: userId, telegramUserId } = await createUser({
      banned: true,
      banReason: "Спам",
    });
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(validAppealBody(telegramUserId), ip);

    // Assert — 201 { id, createdAt }, строка привязана к забаненному.
    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    expect(body.id).toBeTruthy();
    expect(new Date(body.createdAt).getTime()).not.toBeNaN();

    const stored = await db.feedback.findUnique({ where: { id: body.id } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userId);
    expect(stored?.subject).toBe("Обжалование блокировки");
    expect(stored?.text).toBe(
      "Считаю блокировку ошибочной, прошу рассмотреть обращение."
    );
    createdFeedbackIds.push(body.id);
  });

  it("чужой hash → 401, Feedback не создаётся", async () => {
    // Arrange — подпись той же формы, но hash не dev-hash.
    const { id: userId, telegramUserId } = await createUser({ banned: true });
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: devInitData(telegramUserId, "forged-hash"),
        subject: "Тема",
        text: "Текст",
      },
      ip
    );

    // Assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.message).toBe("Invalid or expired signature");
    expect(await countFeedback(userId)).toBe(0);
  });

  it("валидная подпись, но пользователь не найден → 404 NOT_FOUND, Feedback не создаётся", async () => {
    // Arrange — валидная подпись для telegramUserId, которого нет в БД
    // (пользователь не создаётся намеренно).
    const unknownTelegramUserId = ++tgSeq;
    const ip = uniqueIp();
    const before = await db.feedback.count();

    // Act
    const res = await postAppeal(validAppealBody(unknownTelegramUserId), ip);

    // Assert
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("User not found");
    expect(await db.feedback.count()).toBe(before);
  });
});

describe("feedback/appeal: валидация тела → 400 VALIDATION_FAILED", () => {
  // Валидация тела выполняется ДО проверки подписи и поиска пользователя,
  // поэтому пользователи для 400-тестов не создаются: строка initData
  // должна лишь проходить лимиты контракта.

  it("нет initData → 400 VALIDATION_FAILED", async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal({ subject: "Тема", text: "Текст" }, ip);

    // Assert
    await expectValidationFailed(res, "initData");
    expect(await db.feedback.count()).toBe(before);
  });

  it("нет subject → 400 VALIDATION_FAILED", async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      { initData: devInitData(++tgSeq), text: "Текст" },
      ip
    );

    // Assert
    await expectValidationFailed(res, "subject");
    expect(await db.feedback.count()).toBe(before);
  });

  it("нет text → 400 VALIDATION_FAILED", async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      { initData: devInitData(++tgSeq), subject: "Тема" },
      ip
    );

    // Assert
    await expectValidationFailed(res, "text");
    expect(await db.feedback.count()).toBe(before);
  });

  it("initData только из пробелов → 400 VALIDATION_FAILED", async () => {
    // Arrange — zod-схема тримит строки: после trim длина 0 < min(1).
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      { initData: "   ", subject: "Тема", text: "Текст" },
      ip
    );

    // Assert
    await expectValidationFailed(res, "initData");
    expect(await db.feedback.count()).toBe(before);
  });

  it("subject только из пробелов → 400 VALIDATION_FAILED", async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      { initData: devInitData(++tgSeq), subject: "   ", text: "Текст" },
      ip
    );

    // Assert
    await expectValidationFailed(res, "subject");
    expect(await db.feedback.count()).toBe(before);
  });

  it("text только из пробелов → 400 VALIDATION_FAILED", async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      { initData: devInitData(++tgSeq), subject: "Тема", text: "   " },
      ip
    );

    // Assert
    await expectValidationFailed(res, "text");
    expect(await db.feedback.count()).toBe(before);
  });

  it(`initData длиннее ${FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH} символов → 400 VALIDATION_FAILED`, async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: "x".repeat(FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH + 1),
        subject: "Тема",
        text: "Текст",
      },
      ip
    );

    // Assert
    await expectValidationFailed(res, "initData");
    expect(await db.feedback.count()).toBe(before);
  });

  it(`subject длиннее ${FEEDBACK_SUBJECT_MAX_LENGTH} символов → 400 VALIDATION_FAILED`, async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: devInitData(++tgSeq),
        subject: "x".repeat(FEEDBACK_SUBJECT_MAX_LENGTH + 1),
        text: "Текст",
      },
      ip
    );

    // Assert
    await expectValidationFailed(res, "subject");
    expect(await db.feedback.count()).toBe(before);
  });

  it(`text длиннее ${FEEDBACK_TEXT_MAX_LENGTH} символов → 400 VALIDATION_FAILED`, async () => {
    // Arrange
    const before = await db.feedback.count();
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: devInitData(++tgSeq),
        subject: "Тема",
        text: "x".repeat(FEEDBACK_TEXT_MAX_LENGTH + 1),
      },
      ip
    );

    // Assert
    await expectValidationFailed(res, "text");
    expect(await db.feedback.count()).toBe(before);
  });
});

describe("feedback/appeal: rate limit (5 запросов в час с одного IP)", () => {
  it("6-й запрос с одного IP в пределах окна → 429 RATE_LIMITED", async () => {
    // Arrange — один пользователь, один IP: лимитер ключит bucket по IP
    // (feedback-appeal:<ip>), лимит 5 запросов в час. Dev-подписи валидны
    // всегда (hash=dev-hash), свежесть не проверяется в bypass.
    const { id: userId, telegramUserId } = await createUser({ banned: true });
    const ip = uniqueIp();
    const freshBody = () => validAppealBody(telegramUserId);

    // Act — первые 5 запросов укладываются в лимит.
    for (let i = 0; i < 5; i += 1) {
      const res = await postAppeal(freshBody(), ip);
      expect(res.status).toBe(201);
      const created = (await res.json()) as AppealCreatedBody;
      createdFeedbackIds.push(created.id);
    }
    const sixth = await postAppeal(freshBody(), ip);

    // Assert — 6-й отклонён, лишних строк не создано.
    expect(sixth.status).toBe(429);
    const limited = (await sixth.json()) as ErrorBody;
    expect(limited.code).toBe("RATE_LIMITED");
    expect(limited.message).toBe("Too many requests");
    expect(await countFeedback(userId)).toBe(5);
  });

  it("другой IP не попадает под лимит первого", async () => {
    // Arrange — лимитер стоит ДО проверки подписи, поэтому bucket
    // заполняется даже запросами с невалидной подписью (401).
    const { id: userId, telegramUserId } = await createUser({ banned: true });
    const exhaustedIp = uniqueIp();
    const freshIp = uniqueIp();
    const invalidBody = {
      initData: devInitData(telegramUserId, "forged-hash"),
      subject: "Тема",
      text: "Текст",
    };

    // Act — IP A: 5 запросов исчерпывают лимит, 6-й → 429.
    for (let i = 0; i < 5; i += 1) {
      const res = await postAppeal(invalidBody, exhaustedIp);
      expect(res.status).toBe(401);
    }
    const limited = await postAppeal(invalidBody, exhaustedIp);

    // Assert — IP A ограничен.
    expect(limited.status).toBe(429);

    // Act — IP B с валидным payload не затронут лимитом IP A.
    const res = await postAppeal(validAppealBody(telegramUserId), freshIp);

    // Assert
    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    createdFeedbackIds.push(body.id);
    expect(await countFeedback(userId)).toBe(1);
  });
});

describe("feedback/appeal: dev flow (hash=dev-hash)", () => {
  it("dev-hash при ALLOW_DEV_AUTH → 201, Feedback создан (существующий пользователь)", async () => {
    // Arrange — ALLOW_DEV_AUTH под vitest всегда true (см. env.ts),
    // поэтому verifyTelegramInitData принимает hash=dev-hash без HMAC.
    const { id: userId, telegramUserId } = await createUser({ banned: true });
    const ip = uniqueIp();

    // Act
    const res = await postAppeal(
      {
        initData: devInitData(telegramUserId),
        subject: "Обжалование блокировки",
        text: "Обращение из dev-окружения.",
      },
      ip
    );

    // Assert
    expect(res.status).toBe(201);
    const body = (await res.json()) as AppealCreatedBody;
    expect(body.id).toBeTruthy();
    expect(new Date(body.createdAt).getTime()).not.toBeNaN();

    const stored = await db.feedback.findUnique({ where: { id: body.id } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userId);
    createdFeedbackIds.push(body.id);
  });
});
