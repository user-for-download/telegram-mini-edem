import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-dashboard-audit";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-dashboard-audit";
const MARKER = "audittest";

let tgSeq = 9_740_000n;
const userIds: string[] = [];
const tripIds: string[] = [];
const cityIds: string[] = [];
const reviewIds: string[] = [];
const reportIds: string[] = [];
const feedbackIds: string[] = [];

async function createUser(name: string, data: Record<string, unknown> = {}) {
  const user = await db.user.create({
    data: { name: `${name}-${MARKER}`, telegramUserId: ++tgSeq, avatar: "", ...data },
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

async function adminRequest(
  path: string,
  method: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(`${ADMIN_BASE}${path}`, {
    method,
    headers: { ...JSON_HEADERS, Cookie: cookie },
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
        { targetType: "user", targetId: { in: userIds } },
        { action: "city.recompute" },
        { action: "city.create", targetId: { in: cityIds } },
      ],
    },
  });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.review.deleteMany({ where: { id: { in: reviewIds } } });
  await db.report.deleteMany({ where: { id: { in: reportIds } } });
  await db.feedback.deleteMany({ where: { id: { in: feedbackIds } } });
  await db.trip.deleteMany({ where: { id: { in: tripIds } } });
  await db.city.deleteMany({ where: { id: { in: cityIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = tripIds.length = cityIds.length = 0;
  reviewIds.length = reportIds.length = feedbackIds.length = 0;
});

describe("GET /admin/dashboard", () => {
  it("includes actionable queue counts", async () => {
    const user = await createUser("Dashboard User", { tgChatJoinedAt: new Date() });
    const review = await db.review.create({
      data: {
        authorId: user.id,
        targetUserId: user.id,
        rating: 5,
        text: "Pending review",
        targetRole: "driver",
        status: "pending",
        tripRoute: "A → B",
      },
    });
    reviewIds.push(review.id);
    const report = await db.report.create({
      data: {
        reporterId: user.id,
        targetType: "user",
        targetId: user.id,
        category: "spam",
        description: "Open report",
      },
    });
    reportIds.push(report.id);
    const feedback = await db.feedback.create({
      data: { userId: user.id, subject: "No answer", text: "Help" },
    });
    feedbackIds.push(feedback.id);
    const notification = await db.notification.create({
      data: { userId: user.id, type: "trip_cancelled", title: "T", body: "B" },
    });
    await db.notificationDelivery.createMany({
      data: [
        {
          notificationId: notification.id,
          userId: user.id,
          channel: "telegram",
          type: "trip_cancelled",
          status: "pending",
        },
        {
          notificationId: notification.id,
          userId: user.id,
          channel: "telegram",
          type: "trip_cancelled",
          status: "failed",
        },
      ],
    });

    const res = await adminRequest("/dashboard", "GET", cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingReviews).toBeGreaterThanOrEqual(1);
    expect(body.openReports).toBeGreaterThanOrEqual(1);
    expect(body.unansweredFeedback).toBeGreaterThanOrEqual(1);
    expect(body.telegramPending).toBeGreaterThanOrEqual(1);
    expect(body.telegramFailed).toBeGreaterThanOrEqual(1);
    expect(body).toHaveProperty("totalUsers");
  });
});

describe("POST /admin/cities/recompute-trips-count", () => {
  it("recomputes counters in a transaction and is idempotent", async () => {
    const driver = await createUser("City Driver");
    const city = await db.city.create({
      data: {
        name: `Город-${MARKER}`,
        nameNormalized: `город-${MARKER}`,
        tripsCount: 99,
      },
    });
    cityIds.push(city.id);
    const trip = await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: city.name,
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        fromCityId: city.id,
        departureAt: new Date(Date.now() + 3600_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
        status: "active",
      },
    });
    tripIds.push(trip.id);

    const first = await adminRequest(
      "/cities/recompute-trips-count",
      "POST",
      cookie,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.updated).toBeGreaterThanOrEqual(1);

    const updatedCity = await db.city.findUniqueOrThrow({ where: { id: city.id } });
    expect(updatedCity.tripsCount).toBe(1);

    const second = await adminRequest(
      "/cities/recompute-trips-count",
      "POST",
      cookie,
    );
    expect(second.status).toBe(200);
    expect((await second.json()).updated).toBe(firstBody.updated);
    expect(
      (await db.city.findUniqueOrThrow({ where: { id: city.id } })).tripsCount,
    ).toBe(1);
  });
});

describe("GET /admin/audit", () => {
  it("lists, paginates and filters audit rows without PII", async () => {
    const user = await createUser("Audit User", { phone: "+79990007788" });
    const ban = await adminRequest(`/users/${user.id}/ban`, "PATCH", cookie, {
      reason: "Нарушение правил",
    });
    expect(ban.status).toBe(200);

    const res = await adminRequest(
      `/audit?action=user.ban&targetType=user&targetId=${user.id}&page=1&pageSize=10`,
      "GET",
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(body.items[0]).toMatchObject({
      action: "user.ban",
      targetType: "user",
      targetId: user.id,
      actorType: "admin",
    });
    expect(body.items[0].metadata).toEqual({ status: "banned" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Audit User");
    expect(serialized).not.toContain("+79990007788");
    expect(serialized).not.toContain("Нарушение правил");

    const noMatch = await adminRequest(
      `/audit?action=user.unban&targetId=${user.id}`,
      "GET",
      cookie,
    );
    expect((await noMatch.json()).total).toBe(0);
  });

  it("rejects invalid query parameters and unauthenticated access", async () => {
    const invalid = await adminRequest(
      "/audit?action=not.an.action",
      "GET",
      cookie,
    );
    expect(invalid.status).toBe(400);

    const unauth = await app.request(`${ADMIN_BASE}/audit`);
    expect(unauth.status).toBe(401);
  });
});
