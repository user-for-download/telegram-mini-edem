import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-reports-admin";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-reports-admin";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let tgSeq = 9_730_000n;
const userIds: string[] = [];
const tripIds: string[] = [];
const bookingIds: string[] = [];
const reportIds: string[] = [];

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

async function adminGet(path: string, cookie?: string) {
  return app.request(`${ADMIN_BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

async function adminPatch(path: string, cookie: string, body: unknown, origin?: string) {
  return app.request(`${ADMIN_BASE}${path}`, {
    method: "PATCH",
    headers: {
      ...JSON_HEADERS,
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
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
    where: { targetType: "report", targetId: { in: reportIds } },
  });
  await db.report.deleteMany({ where: { id: { in: reportIds } } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.trip.deleteMany({ where: { id: { in: tripIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = tripIds.length = bookingIds.length = reportIds.length = 0;
});

describe("Admin reports", () => {
  it("lists with targetType filter and flat pagination", async () => {
    const reporter = await createUser("Report Reporter");
    const target = await createUser("Report Target");
    const driver = await createUser("Report Driver");
    const passenger = await createUser("Report Passenger");
    const trip = await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date(Date.now() + 3600_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
      },
    });
    tripIds.push(trip.id);
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "confirmed" },
    });
    bookingIds.push(booking.id);

    const [userReport, tripReport, bookingReport] = await Promise.all([
      db.report.create({
        data: {
          reporterId: reporter.id,
          targetType: "user",
          targetId: target.id,
          category: "safety",
          description: "User report",
        },
      }),
      db.report.create({
        data: {
          reporterId: reporter.id,
          targetType: "trip",
          targetId: trip.id,
          category: "safety",
          description: "Trip report",
        },
      }),
      db.report.create({
        data: {
          reporterId: reporter.id,
          targetType: "booking",
          targetId: booking.id,
          category: "fraud",
          description: "Booking report",
        },
      }),
    ]);
    reportIds.push(userReport.id, tripReport.id, bookingReport.id);

    const res = await adminGet("/reports?targetType=trip&page=1&pageSize=10", cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(body).not.toHaveProperty("pagination");
    expect(body.items[0].targetSummary).toMatchObject({
      targetType: "trip",
      tripId: trip.id,
      label: "Москва → Тула",
    });

    const userRes = await adminGet("/reports?targetType=user", cookie);
    expect((await userRes.json()).items[0].targetSummary).toMatchObject({
      targetType: "user",
      userId: target.id,
      label: target.name,
    });

    const bookingRes = await adminGet("/reports?targetType=booking", cookie);
    expect((await bookingRes.json()).items[0].targetSummary).toMatchObject({
      targetType: "booking",
      bookingId: booking.id,
      userId: passenger.id,
      tripId: trip.id,
    });
  });

  it("returns detail and 404", async () => {
    const reporter = await createUser("Report Detail Reporter");
    const target = await createUser("Report Detail Target");
    const report = await db.report.create({
      data: {
        reporterId: reporter.id,
        targetType: "user",
        targetId: target.id,
        category: "spam",
        description: "Detail report",
      },
    });
    reportIds.push(report.id);

    const res = await adminGet(`/reports/${report.id}`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(report.id);
    expect(body.targetSummary.label).toBe(target.name);

    const missing = await adminGet(`/reports/${MISSING_ID}`, cookie);
    expect(missing.status).toBe(404);
  });

  it("transitions status, rejects terminal conflict and validation errors", async () => {
    const reporter = await createUser("Report Status Reporter");
    const target = await createUser("Report Status Target");
    const report = await db.report.create({
      data: {
        reporterId: reporter.id,
        targetType: "user",
        targetId: target.id,
        category: "spam",
        description: "Status report",
      },
    });
    reportIds.push(report.id);

    const inReview = await adminPatch(`/reports/${report.id}/status`, cookie, {
      status: "in_review",
    });
    expect(inReview.status).toBe(200);
    expect((await inReview.json()).status).toBe("in_review");

    const resolved = await adminPatch(`/reports/${report.id}/status`, cookie, {
      status: "resolved",
      resolutionNote: "Проверено",
    });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).status).toBe("resolved");

    const terminal = await adminPatch(`/reports/${report.id}/status`, cookie, {
      status: "in_review",
    });
    expect(terminal.status).toBe(409);

    const invalid = await adminPatch(`/reports/${report.id}/status`, cookie, {
      status: "bogus",
    });
    expect(invalid.status).toBe(400);

    const audit = await db.adminAuditLog.findMany({
      where: { action: "report.status", targetId: report.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => row.metadata)).toEqual([
      { from: "pending", to: "in_review" },
      { from: "in_review", to: "resolved" },
    ]);
  });

  it("requires admin auth and rejects cross-site CSRF", async () => {
    expect((await adminGet("/reports")).status).toBe(401);

    const reporter = await createUser("Report Csrf Reporter");
    const target = await createUser("Report Csrf Target");
    const report = await db.report.create({
      data: {
        reporterId: reporter.id,
        targetType: "user",
        targetId: target.id,
        category: "spam",
        description: "Csrf report",
      },
    });
    reportIds.push(report.id);

    const res = await adminPatch(
      `/reports/${report.id}/status`,
      cookie,
      { status: "in_review" },
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });
});
