// backend/tests/integration/bot-webhook.test.ts
//
// POST /bot/webhook/:secret — фиксация и отзыв согласия на сообщения
// бота (bot-api shadow mode, approval-package §4.2).
//
// Секрет задаю до импорта env (vi.hoisted): сравнение timing-safe,
// неверный секрет → 404 (не раскрываем существование endpoint).
// /start проставляет tgChatJoinedAt только по совпадению telegramUserId;
// /stop сбрасывает. Чужие команды и мусорные body → 200 без побочных
// эффектов (Telegram не ретраит). Логи: command + userId, без текста.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-123";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const SECRET = "test-webhook-secret-123";
const URL = (secret: string) => `/bot/webhook/${secret}`;
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_930_000n;

async function createTelegramUser(): Promise<{ id: string; tgId: bigint }> {
  const tgId = tgSeq++;
  const user = await db.user.create({
    data: {
      name: `Bot Hook ${tgId}`,
      avatar: "",
      telegramUserId: tgId,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("POST /bot/webhook/:secret — валидация секрета", () => {
  it("неверный секрет → 404, согласие не меняется", async () => {
    const { tgId } = await createTelegramUser();

    const res = await app.request(URL("wrong-secret"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: { from: { id: Number(tgId) }, text: "/start" },
      }),
    });

    expect(res.status).toBe(404);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).toBeNull();
  });

  it("пустой секрет в path → 404", async () => {
    const res = await app.request(URL(""), {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /bot/webhook/:secret — /start", () => {
  it("start от известного пользователя → tgChatJoinedAt проставлен", async () => {
    const { tgId } = await createTelegramUser();

    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: {
          from: { id: Number(tgId), is_bot: false },
          chat: { id: Number(tgId) },
          text: "/start",
        },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).not.toBeNull();
  });

  it("start от неизвестного telegramId → 200, но ничего не меняется", async () => {
    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: {
          from: { id: 123456789 },
          chat: { id: 123456789 },
          text: "/start",
        },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({
      where: { telegramUserId: 123456789n },
    });
    expect(user).toBeNull();
  });

  it("start с параметром (deep-link ?start=notify) → тоже согласие", async () => {
    const { tgId } = await createTelegramUser();

    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: {
          from: { id: Number(tgId) },
          chat: { id: Number(tgId) },
          text: "/start notify",
        },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).not.toBeNull();
  });
});

describe("POST /bot/webhook/:secret — /stop", () => {
  it("stop сбрасывает ранее выданное согласие", async () => {
    const { tgId } = await createTelegramUser();
    await db.user.updateMany({
      where: { telegramUserId: tgId },
      data: { tgChatJoinedAt: new Date() },
    });

    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: {
          from: { id: Number(tgId) },
          chat: { id: Number(tgId) },
          text: "/stop",
        },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).toBeNull();
  });
});

describe("POST /bot/webhook/:secret — шумовые апдейты", () => {
  it("мусорный body → 200 без ошибок", async () => {
    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: "not-json",
    });
    expect(res.status).toBe(200);
  });

  it("чужая команда → 200, согласие не меняется", async () => {
    const { tgId } = await createTelegramUser();

    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: {
          from: { id: Number(tgId) },
          chat: { id: Number(tgId) },
          text: "/help",
        },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).toBeNull();
  });

  it("edited_message с /stop обрабатывается как /stop", async () => {
    const { tgId } = await createTelegramUser();
    await db.user.updateMany({
      where: { telegramUserId: tgId },
      data: { tgChatJoinedAt: new Date() },
    });

    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        edited_message: { from: { id: Number(tgId) }, text: "/stop" },
      }),
    });

    expect(res.status).toBe(200);
    const user = await db.user.findFirst({ where: { telegramUserId: tgId } });
    expect(user?.tgChatJoinedAt).toBeNull();
  });

  it("апдейт без message (callback_query) → 200 без побочных эффектов", async () => {
    const res = await app.request(URL(SECRET), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ callback_query: { id: "1", data: "x" } }),
    });
    expect(res.status).toBe(200);
  });
});
