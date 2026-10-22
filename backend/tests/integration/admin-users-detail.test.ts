import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-users-detail";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-users-detail";
const MARKER = "usersdetail";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let tgSeq = 9_700_000n;
const userIds: string[] = [];
const tripIds: string[] = [];
const bookingIds: string[] = [];
const feedbackIds: string[] = [];
const reportIds: string[] = [];

async function createUser(
  name: string,
  data: Record<string, unknown> = {},
): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `${name}-${MARKER}`,
      telegramUserId: ++tgSeq,
      avatar: "",
      ...data,
    },
  });
  userIds.push(user.id);
  return user.id;
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
    where: { targetType: "user", targetId: { in: userIds } },
  });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.feedback.deleteMany({ where: { id: { in: feedbackIds } } });
  await db.report.deleteMany({ where: { id: { in: reportIds } } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.trip.deleteMany({ where: { id: { in: tripIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = tripIds.length = bookingIds.length = 0;
  feedbackIds.length = reportIds.length = 0;
});

describe("GET /admin/users — exact filters", () => {
  it("searches by name, id, telegram id and phone", async () => {
    const alpha = await createUser("Alpha Search", { phone: "+79990001122" });
    const beta = await createUser("Beta Search", { phone: "+79990003344" });
    const alphaUser = await db.user.findUniqueOrThrow({ where: { id: alpha } });

    const byName = await adminGet(`/users?q=${encodeURIComponent("Alpha")}`, cookie);
    expect(byName.status).toBe(200);
    expect((await byName.json()).items.map((u: { id: string }) => u.id)).toEqual([
      alpha,
    ]);

    const byId = await adminGet(`/users?id=${alpha}`, cookie);
    expect((await byId.json()).items.map((u: { id: string }) => u.id)).toEqual([
      alpha,
    ]);

    const byTelegram = await adminGet(
      `/users?telegramUserId=${alphaUser.telegramUserId}`,
      cookie,
    );
    expect((await byTelegram.json()).items.map((u: { id: string }) => u.id)).toEqual([
      alpha,
    ]);

    const byPhone = await adminGet(
      `/users?phone=${encodeURIComponent("+79990003344")}`,
      cookie,
    );
    expect((await byPhone.json()).items.map((u: { id: string }) => u.id)).toEqual([
      beta,
    ]);
  });

  it("rejects malformed telegram id", async () => {
    const res = await adminGet("/users?telegramUserId=not-a-number", cookie);
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/users/:id — bounded detail", () => {
  it("returns related trips, bookings, reports and feedback", async () => {
    const driver = await createUser("Detail Driver");
    const passenger = await createUser("Detail Passenger");
    const trip = await db.trip.create({
      data: {
        driverId: driver,
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
      data: { tripId: trip.id, passengerId: passenger, seat: 1, status: "confirmed" },
    });
    bookingIds.push(booking.id);
    const feedback = await db.feedback.create({
      data: { userId: passenger, subject: "Help", text: "Need help" },
    });
    feedbackIds.push(feedback.id);
    const report = await db.report.create({
      data: {
        reporterId: passenger,
        targetType: "user",
        targetId: driver,
        category: "safety",
        description: "Report",
      },
    });
    reportIds.push(report.id);

    const res = await adminGet(`/users/${passenger}`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(passenger);
    expect(body.recentTrips).toHaveLength(0);
    expect(body.recentBookings.map((b: { id: string }) => b.id)).toContain(
      booking.id,
    );
    expect(body.recentFeedback.map((f: { id: string }) => f.id)).toContain(
      feedback.id,
    );
    expect(body.recentReports.map((r: { id: string }) => r.id)).toContain(
      report.id,
    );
    expect(body.telegramConnected).toBe(false);
    expect(body.phone).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await adminGet(`/users/${MISSING_ID}`, cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /admin/users/:id/telegram-stop", () => {
  it("clears consent, cancels pending deliveries and is idempotent", async () => {
    const userId = await createUser("Telegram Stop", {
      tgChatJoinedAt: new Date(),
    });
    const notification = await db.notification.create({
      data: { userId, type: "trip_cancelled", title: "T", body: "B" },
    });
    await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        userId,
        channel: "telegram",
        type: "trip_cancelled",
        status: "pending",
      },
    });

    const first = await app.request(
      `${ADMIN_BASE}/users/${userId}/telegram-stop`,
      { method: "PATCH", headers: { Cookie: cookie } },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      success: true,
      hadConsent: true,
      cancelledDeliveries: 1,
    });

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.tgChatJoinedAt).toBeNull();
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { userId },
    });
    expect(delivery.status).toBe("skipped");
    expect(delivery.error).toBe("admin_stopped");

    const second = await app.request(
      `${ADMIN_BASE}/users/${userId}/telegram-stop`,
      { method: "PATCH", headers: { Cookie: cookie } },
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      success: true,
      hadConsent: false,
      cancelledDeliveries: 0,
    });

    const audit = await db.adminAuditLog.findMany({
      where: { action: "user.telegram_stop", targetId: userId },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]?.metadata).toMatchObject({ cancelledDeliveries: 1 });
  });
});
