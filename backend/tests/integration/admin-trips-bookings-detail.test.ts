import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-trips-bookings";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
  process.env.ADMIN_READ_RATE_MAX = "5000";
  process.env.MUTATION_RATE_MAX = "5000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");

const ADMIN_BASE = "/api/v1/admin";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-trips-bookings";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let tgSeq = 9_710_000n;
const userIds: string[] = [];
const tripIds: string[] = [];
const bookingIds: string[] = [];

async function createUser(name: string, data: Record<string, unknown> = {}) {
  const user = await db.user.create({
    data: {
      name,
      telegramUserId: ++tgSeq,
      avatar: "",
      ...data,
    },
  });
  userIds.push(user.id);
  return user;
}

async function createTrip(
  driverId: string,
  data: Record<string, unknown> = {},
) {
  const trip = await db.trip.create({
    data: {
      driverId,
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
      ...data,
    },
  });
  tripIds.push(trip.id);
  return trip;
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
    where: {
      OR: [
        { targetType: "trip", targetId: { in: tripIds } },
        { targetType: "booking", targetId: { in: bookingIds } },
      ],
    },
  });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.trip.deleteMany({ where: { id: { in: tripIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = tripIds.length = bookingIds.length = 0;
});

describe("GET /admin/trips", () => {
  it("filters by status, driver, route and q", async () => {
    const driver = await createUser("Trip Driver One");
    const otherDriver = await createUser("Trip Driver Two");
    const active = await createTrip(driver.id, {
      fromCity: "Москва",
      toCity: "Тула",
    });
    const cancelled = await createTrip(otherDriver.id, {
      fromCity: "Сочи",
      toCity: "Адлер",
      status: "cancelled",
    });

    const byDriver = await adminGet(`/trips?driverId=${driver.id}`, cookie);
    expect(byDriver.status).toBe(200);
    expect((await byDriver.json()).items.map((t: { id: string }) => t.id)).toEqual([
      active.id,
    ]);

    const byStatus = await adminGet("/trips?status=cancelled", cookie);
    expect((await byStatus.json()).items.map((t: { id: string }) => t.id)).toContain(
      cancelled.id,
    );

    const byRoute = await adminGet(
      `/trips?fromCity=${encodeURIComponent("Сочи")}&toCity=${encodeURIComponent("Адлер")}`,
      cookie,
    );
    expect((await byRoute.json()).items.map((t: { id: string }) => t.id)).toContain(
      cancelled.id,
    );

    const bySearch = await adminGet(
      `/trips?q=${encodeURIComponent("Москва")}`,
      cookie,
    );
    expect((await bySearch.json()).items.map((t: { id: string }) => t.id)).toContain(
      active.id,
    );
  });
});

describe("GET /admin/trips/:id", () => {
  it("returns trip detail with bounded bookings and 404", async () => {
    const driver = await createUser("Trip Detail Driver");
    const passenger = await createUser("Trip Detail Passenger");
    const trip = await createTrip(driver.id);
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "confirmed" },
    });
    bookingIds.push(booking.id);

    const res = await adminGet(`/trips/${trip.id}`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(trip.id);
    expect(body.driverId).toBe(driver.id);
    expect(body.bookings.map((b: { id: string }) => b.id)).toContain(booking.id);

    const missing = await adminGet(`/trips/${MISSING_ID}`, cookie);
    expect(missing.status).toBe(404);
  });
});

describe("GET /admin/bookings", () => {
  it("filters by passenger, trip, status and q", async () => {
    const driver = await createUser("Booking Driver");
    const passenger = await createUser("Booking Passenger");
    const otherPassenger = await createUser("Booking Other");
    const trip = await createTrip(driver.id, { fromCity: "Казань", toCity: "Самара" });
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "confirmed" },
    });
    const otherBooking = await db.booking.create({
      data: {
        tripId: trip.id,
        passengerId: otherPassenger.id,
        seat: 2,
        status: "cancelled",
      },
    });
    bookingIds.push(booking.id, otherBooking.id);

    const byPassenger = await adminGet(
      `/bookings?passengerId=${passenger.id}`,
      cookie,
    );
    expect((await byPassenger.json()).items.map((b: { id: string }) => b.id)).toEqual([
      booking.id,
    ]);

    const byTrip = await adminGet(`/bookings?tripId=${trip.id}`, cookie);
    expect((await byTrip.json()).total).toBe(2);

    const byStatus = await adminGet("/bookings?status=cancelled", cookie);
    expect((await byStatus.json()).items.map((b: { id: string }) => b.id)).toContain(
      otherBooking.id,
    );

    const bySearch = await adminGet(
      `/bookings?q=${encodeURIComponent("Booking Passenger")}`,
      cookie,
    );
    expect((await bySearch.json()).items.map((b: { id: string }) => b.id)).toEqual([
      booking.id,
    ]);
  });
});

describe("GET /admin/bookings/:id", () => {
  it("returns booking, trip and passenger context with 404", async () => {
    const driver = await createUser("Booking Detail Driver");
    const passenger = await createUser("Booking Detail Passenger", {
      phone: "+79990005566",
      rating: 4.7,
    });
    const trip = await createTrip(driver.id, {
      fromCity: "Тверь",
      toCity: "Москва",
      status: "active",
    });
    const booking = await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "pending" },
    });
    bookingIds.push(booking.id);

    const res = await adminGet(`/bookings/${booking.id}`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: booking.id,
      fromCity: "Тверь",
      toCity: "Москва",
      status: "pending",
      tripStatus: "active",
      driverId: driver.id,
      passengerId: passenger.id,
      passengerPhone: "+79990005566",
    });

    const missing = await adminGet(`/bookings/${MISSING_ID}`, cookie);
    expect(missing.status).toBe(404);
  });
});
