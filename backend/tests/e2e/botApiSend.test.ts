// backend/tests/e2e/botApiSend.test.ts
//
// E2E реальной отправки (bot-api-send, ADR approved 2026-09-14):
// токен задан через vi.hoisted ДО импорта src (изоляция файлов —
// botApiShadow.test.ts остаётся без токена и проверяет shadow-путь).
//
// api.telegram.org мокается fetch-шпионом: реальные вызовы невозможны
// в test-среде по построению (vi.stubGlobal перехватывает всё).
//
// Циклы: 200 → delivered без shadow; 403 → skipped/bot_blocked +
// сброс согласия + следующее событие тихо; 429 → pending с retry_after;
// kill-switch с токеном → channel_disabled без вызовов; кнопка «Открыть»
// при TELEGRAM_WEBAPP_URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "send-e2e-secret-123";
  process.env.TELEGRAM_BOT_TOKEN = "send-e2e-token";
  process.env.TELEGRAM_WEBAPP_URL = "https://t.me/edem_bot/app";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { env } = await import("../../src/env.js");
const { createNotification } = await import(
  "../../src/services/notification.service.js"
);
const { pollOnce } = await import(
  "../../src/workers/notificationDispatcher.js"
);

const SECRET = "send-e2e-secret-123";
const TOKEN = "send-e2e-token";
const SEND_URL = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
const JSON_HEADERS = { "Content-Type": "application/json" };

const createdUserIds: string[] = [];
let tgSeq = 9_970_000n;
let fetchSpy: ReturnType<typeof vi.fn>;

async function seedUser(data: Record<string, unknown> = {}): Promise<{ id: string; tgId: bigint }> {
  const tgId = tgSeq++;
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `SendE2E ${tgId}`,
      avatar: "",
      tgChatJoinedAt: new Date(),
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

async function deliveriesOf(userId: string) {
  return db.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

/** fetch-мок: sendMessage → заданный статус/тело; прочее → 404. */
function mockTelegramSend(status: number, body: unknown): void {
  fetchSpy.mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as Request).url);
    if (url === SEND_URL) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
}

function sentBodies(): Array<Record<string, unknown>> {
  return fetchSpy.mock.calls
    .filter((call) => String(call[0]) === SEND_URL)
    .map((call) => JSON.parse(String(call[1]?.body ?? "{}")));
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  mockTelegramSend(200, { ok: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  env.TELEGRAM_DELIVERY_ENABLED = true;
  await db.notification.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("E2E real-send: happy path", () => {
  it("событие → pollOnce → sendMessage 200 → delivered без shadow", async () => {
    const user = await seedUser();

    await createNotification(
      user.id,
      "trip_cancelled",
      "Поездка отменена",
      "Поездка Москва → Казань отменена",
      "/bookings",
    );

    const claimed = await pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(1);

    // Ровно один вызов sendMessage с корректным телом.
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]) === SEND_URL)).toHaveLength(1);
    const body = sentBodies()[0];
    expect(body.chat_id).toBe(Number(user.tgId));
    expect(body.text).toBe(
      "Поездка отменена\n\nПоездка Москва → Казань отменена",
    );
    expect(body.disable_web_page_preview).toBe(true);
    // Кнопка «Открыть»: web_app URL = TELEGRAM_WEBAPP_URL + deep-link.
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[
        {
          text: "Открыть",
          web_app: { url: "https://t.me/edem_bot/app/bookings" },
        },
      ]],
    });

    // Разметка: delivered, error=null (НЕ shadow).
    const deliveries = await deliveriesOf(user.id);
    expect(deliveries[0].status).toBe("delivered");
    expect(deliveries[0].error).toBeNull();
  });
});

describe("E2E real-send: 403 bot_blocked", () => {
  it("403 → skipped + согласие сброшено; следующее событие тихо", async () => {
    mockTelegramSend(403, { ok: false, error_code: 403 });
    const user = await seedUser();

    await createNotification(user.id, "trip_cancelled", "T", "B");
    await pollOnce();

    const deliveries = await deliveriesOf(user.id);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("bot_blocked");

    // Согласие отозвано автоматически.
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tgChatJoinedAt).toBeNull();

    // Новое событие: тихо skipped/no_chat без вызова API.
    const callsBefore = fetchSpy.mock.calls.length;
    await createNotification(user.id, "booking_created", "T2", "B2");
    await pollOnce();

    const all = await deliveriesOf(user.id);
    expect(all[1].status).toBe("skipped");
    expect(all[1].error).toBe("no_chat");
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });
});

describe("E2E real-send: 429 rate_limited", () => {
  it("429 с retry_after → pending, nextAttemptAt в будущем, attempts=1", async () => {
    mockTelegramSend(429, {
      ok: false,
      error_code: 429,
      parameters: { retry_after: 120 },
    });
    const user = await seedUser();

    await createNotification(user.id, "trip_cancelled", "T", "B");
    await pollOnce();

    const deliveries = await deliveriesOf(user.id);
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].error).toBe("rate_limited");
    expect(deliveries[0].attempts).toBe(1);
    expect(deliveries[0].nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });
});

describe("E2E real-send: kill-switch", () => {
  it("TELEGRAM_DELIVERY_ENABLED=false при токене → skipped, api не зовётся", async () => {
    env.TELEGRAM_DELIVERY_ENABLED = false;
    const user = await seedUser();

    await createNotification(user.id, "trip_cancelled", "T", "B");
    await pollOnce();

    const deliveries = await deliveriesOf(user.id);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toBe("channel_disabled");
    expect(
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes("api.telegram.org")),
    ).toHaveLength(0);
  });
});
