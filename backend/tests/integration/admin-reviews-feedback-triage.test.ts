import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-triage";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-triage";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let tgSeq = 9_720_000n;
const userIds: string[] = [];
const reviewIds: string[] = [];
const feedbackIds: string[] = [];

async function createUser(name: string) {
  const user = await db.user.create({
    data: { name, telegramUserId: ++tgSeq, avatar: "" },
  });
  userIds.push(user.id);
  return user;
}

function extractCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /edem_admin_jwt=([^;]+)/.exec(setCookie);
  if (!match) throw new Error("admin login did not set cookie");
  return `edem_admin_jwt=${match[1]}`;
}

async function adminGet(path: string, cookie: string) {
  return app.request(`${ADMIN_BASE}${path}`, { headers: { Cookie: cookie } });
}

async function adminRequest(
  path: string,
  method: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(`${ADMIN_BASE}${path}`, {
    method,
    headers: {
      ...JSON_HEADERS,
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let cookie: string;
beforeEach(async () => {
  const login = await app.request(`${ADMIN_BASE}/auth/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  cookie = extractCookie(login);
});

afterEach(async () => {
  await db.adminAuditLog.deleteMany({
    where: {
      OR: [
        { targetType: "review", targetId: { in: reviewIds } },
        { targetType: "feedback", targetId: { in: feedbackIds } },
      ],
    },
  });
  await db.review.deleteMany({ where: { id: { in: reviewIds } } });
  await db.feedback.deleteMany({ where: { id: { in: feedbackIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = reviewIds.length = feedbackIds.length = 0;
});

describe("Admin reviews", () => {
  it("filters by author, target, text and status, and returns detail", async () => {
    const author = await createUser("Review Author");
    const target = await createUser("Review Target");
    const otherAuthor = await createUser("Review Other Author");
    const pending = await db.review.create({
      data: {
        authorId: author.id,
        targetUserId: target.id,
        rating: 5,
        text: "Отличная поездка triage",
        targetRole: "driver",
        status: "pending",
        tripRoute: "Москва → Тула",
      },
    });
    const published = await db.review.create({
      data: {
        authorId: otherAuthor.id,
        targetUserId: target.id,
        rating: 4,
        text: "Другая поездка",
        targetRole: "passenger",
        status: "published",
        tripRoute: "Сочи → Адлер",
      },
    });
    reviewIds.push(pending.id, published.id);

    const byAuthor = await adminGet(`/reviews?authorId=${author.id}`, cookie);
    expect((await byAuthor.json()).items.map((r: { id: string }) => r.id)).toEqual([
      pending.id,
    ]);

    const byTarget = await adminGet(`/reviews?targetUserId=${target.id}`, cookie);
    expect((await byTarget.json()).total).toBe(2);

    const byStatus = await adminGet("/reviews?status=published", cookie);
    expect((await byStatus.json()).items.map((r: { id: string }) => r.id)).toContain(
      published.id,
    );

    const bySearch = await adminGet(
      `/reviews?q=${encodeURIComponent("triage")}`,
      cookie,
    );
    expect((await bySearch.json()).items.map((r: { id: string }) => r.id)).toEqual([
      pending.id,
    ]);

    const detail = await adminGet(`/reviews/${pending.id}`, cookie);
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.author).toMatchObject({ id: author.id, name: author.name });
    expect(body.target).toMatchObject({ id: target.id, name: target.name });

    const missing = await adminGet(`/reviews/${MISSING_ID}`, cookie);
    expect(missing.status).toBe(404);
  });
});

describe("Admin feedback triage", () => {
  it("filters answered/unanswered, searches and returns detail", async () => {
    const user = await createUser("Feedback User");
    const otherUser = await createUser("Feedback Other");
    const unanswered = await db.feedback.create({
      data: {
        userId: user.id,
        subject: "Проблема triage",
        text: "Не приходит уведомление",
      },
    });
    const answered = await db.feedback.create({
      data: {
        userId: otherUser.id,
        subject: "Старый вопрос",
        text: "Спасибо",
        reply: "Рады помочь",
        repliedAt: new Date(),
      },
    });
    feedbackIds.push(unanswered.id, answered.id);

    const noReply = await adminGet("/feedback?answered=false", cookie);
    expect((await noReply.json()).items.map((f: { id: string }) => f.id)).toEqual([
      unanswered.id,
    ]);

    const withReply = await adminGet("/feedback?answered=true", cookie);
    expect((await withReply.json()).items.map((f: { id: string }) => f.id)).toContain(
      answered.id,
    );

    const bySearch = await adminGet(
      `/feedback?q=${encodeURIComponent("triage")}`,
      cookie,
    );
    expect((await bySearch.json()).items.map((f: { id: string }) => f.id)).toEqual([
      unanswered.id,
    ]);

    const detail = await adminGet(`/feedback/${unanswered.id}`, cookie);
    expect(detail.status).toBe(200);
    expect((await detail.json()).subject).toBe("Проблема triage");

    const missing = await adminGet(`/feedback/${MISSING_ID}`, cookie);
    expect(missing.status).toBe(404);
  });

  it("reply creates a reply, audit row and accepts no PII in metadata shape", async () => {
    const user = await createUser("Feedback Reply User");
    const feedback = await db.feedback.create({
      data: {
        userId: user.id,
        subject: "Нужен ответ",
        text: "Помогите",
      },
    });
    feedbackIds.push(feedback.id);

    const res = await adminRequest(
      `/feedback/${feedback.id}/reply`,
      "POST",
      cookie,
      { reply: "Ответ поддержки" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("Ответ поддержки");

    const audit = await db.adminAuditLog.findFirstOrThrow({
      where: { action: "feedback.reply", targetId: feedback.id },
    });
    expect(audit.metadata).toEqual({ mode: "create" });
  });
});
