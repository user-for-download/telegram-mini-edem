import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { env } from "../../src/env.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { hashToken } from "../../src/auth/tokens.js";
import * as sanitizer from "../../src/middleware/sanitize.js";
import {
  adminLogin, authHeaders, cleanupTelegramFixtures, ipHeaders, nextTelegramId,
  seedCar, seedCity, seedTelegramUser, telegramLogin, trackTrip, uniqueIp,
} from "../fixtures/telegram.js";

const originalEnv = { ADMIN_TOKEN: env.ADMIN_TOKEN, TRUST_PROXY: env.TRUST_PROXY, TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN };
const ADMIN_TOKEN = "release-regressions-admin-token-32-chars";
let cookie: string;
let driver: string;
let passenger: string;
let from: { id: string; name: string };
let to: { id: string; name: string };
let departure: Date;
const tripIds: string[] = [];
const actorIds: string[] = [];

function request(path: string, method = "GET", actor?: string, body?: unknown, admin = false) {
  return app.request(path, {
    method,
    headers: {
      ...(actor ? authHeaders(actor, uniqueIp()) : ipHeaders(uniqueIp())),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(admin ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function tripBody(date = departure) {
  return {
    fromCity: from.name, toCity: to.name, fromCityId: from.id, toCityId: to.id,
    fromAddress: "Вокзал", toAddress: "Площадь", departureAt: date.toISOString(),
    durationMinutes: 60, distanceKm: 100, price: 700, seatsTotal: 3, tags: [], matchingEnabled: false,
  };
}

async function createTrip(owner = driver, date = departure): Promise<string> {
  const response = await request("/api/v1/trips", "POST", owner, tripBody(date));
  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };
  tripIds.push(id);
  trackTrip(id);
  return id;
}

async function book(tripId: string, owner = passenger): Promise<string> {
  const response = await request("/api/v1/bookings", "POST", owner, { tripId, seat: 1 });
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

async function confirm(id: string) {
  expect((await request(`/api/v1/bookings/${id}/status`, "PATCH", driver, { status: "confirmed" })).status).toBe(200);
}

function pauseBody() {
  let admitted!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>(resolve => { admitted = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  const original = sanitizer.getSanitizedBody;
  const spy = vi.spyOn(sanitizer, "getSanitizedBody").mockImplementationOnce(async c => {
    const body = await original(c);
    admitted();
    await released;
    return body;
  });
  return { entered, resume, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  expect(new URL(env.DATABASE_URL).pathname).toBe("/edem_test");
  env.ADMIN_TOKEN = ADMIN_TOKEN;
  env.TRUST_PROXY = true;
  env.TELEGRAM_BOT_TOKEN = "";
  cookie = await adminLogin(app, ADMIN_TOKEN);
});

beforeEach(async () => {
  driver = (await seedTelegramUser({ tgChatJoinedAt: new Date() })).id;
  passenger = (await seedTelegramUser({ tgChatJoinedAt: new Date() })).id;
  actorIds.push(driver, passenger);
  await seedCar(driver);
  from = await seedCity("Release from");
  to = await seedCity("Release to");
  departure = new Date(Date.now() + 48 * 3_600_000);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.adminAuditLog.deleteMany({ where: { targetId: { in: [...actorIds, ...tripIds, from.id, to.id] } } });
  await cleanupTelegramFixtures();
  await db.user.deleteMany({ where: { id: { in: actorIds } } });
  actorIds.length = 0;
  tripIds.length = 0;
});

afterAll(async () => {
  await db.adminSession.deleteMany({ where: { adminTokenHash: hashToken(ADMIN_TOKEN) } });
  Object.assign(env, originalEnv);
});

describe("release regressions: transactional identity and trip lifecycle", () => {
  it.each(["POST", "PATCH"])("rejects an admitted %s car save after deletion without recreating personal data", async method => {
    const gate = pauseBody();
    const saving = Promise.resolve(request("/api/v1/users/me/car", method, passenger, { model: "Private car", color: "red", plate: "PRIVATE" }));
    try {
      await gate.entered;
      expect((await request("/api/v1/users/me", "DELETE", passenger)).status).toBe(200);
      gate.resume();
      expect((await saving).status).toBe(403);
      expect(await db.car.count({ where: { userId: passenger } })).toBe(0);
    } finally { gate.resume(); await Promise.allSettled([saving]); gate.restore(); }
  });

  it("rechecks the car after an admitted trip publication", async () => {
    const gate = pauseBody();
    const publishing = Promise.resolve(request("/api/v1/trips", "POST", driver, tripBody()));
    try {
      await gate.entered;
      expect((await request("/api/v1/users/me/car", "DELETE", driver)).status).toBe(200);
      gate.resume();
      const response = await publishing;
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "NO_CAR" });
      expect(await db.trip.count({ where: { driverId: driver } })).toBe(0);
    } finally { gate.resume(); await Promise.allSettled([publishing]); gate.restore(); }
  });

  it("rolls back car deletion when an overlapping trip publication commits first", async () => {
    let admitted!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { admitted = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(
      <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Parameters<typeof db.$transaction>[1]) =>
        original(async tx => {
          await tx.user.findUniqueOrThrow({ where: { id: driver }, include: { car: true } });
          await tx.trip.findFirst({ where: { driverId: driver, status: "active" } });
          admitted();
          await released;
          return run(tx);
        }, { ...options, timeout: 15_000 }),
    );
    const deleting = Promise.resolve(request("/api/v1/users/me/car", "DELETE", driver));
    try {
      await entered;
      const id = await createTrip();
      resume();
      expect((await deleting).status).toBe(409);
      expect(await db.car.count({ where: { userId: driver } })).toBe(1);
      expect((await db.trip.findUniqueOrThrow({ where: { id } })).status).toBe("active");
    } finally { resume(); await Promise.allSettled([deleting]); spy.mockRestore(); }
  });

  it("rejects an admitted booking after the passenger deletes the account", async () => {
    const tripId = await createTrip();
    const gate = pauseBody();
    const booking = Promise.resolve(request("/api/v1/bookings", "POST", passenger, { tripId, seat: 1 }));
    try {
      await gate.entered;
      expect((await request("/api/v1/users/me", "DELETE", passenger)).status).toBe(200);
      gate.resume();
      expect((await booking).status).toBe(403);
      expect(await db.booking.count({ where: { tripId } })).toBe(0);
      expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).seatsAvailable).toBe(3);
    } finally { gate.resume(); await Promise.allSettled([booking]); gate.restore(); }
  });

  it("cancels a future driver's trip without completed-trip credit or review permission", async () => {
    const tripId = await createTrip();
    const bookingId = await book(tripId);
    await confirm(bookingId);
    expect((await request("/api/v1/users/me", "DELETE", driver)).status).toBe(200);
    expect(await db.trip.findUniqueOrThrow({ where: { id: tripId } })).toMatchObject({ status: "cancelled", seatsAvailable: 0 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "cancelled" });
    expect((await db.user.findUniqueOrThrow({ where: { id: passenger } })).tripsCount).toBe(0);
    expect((await db.city.findUniqueOrThrow({ where: { id: from.id } })).tripsCount).toBe(0);
    const bookings = await (await request("/api/v1/bookings/my", "GET", passenger)).json() as Array<{ id: string; canReview: boolean }>;
    expect(bookings.find(b => b.id === bookingId)?.canReview).toBe(false);
    expect(await db.notification.count({ where: { userId: passenger, type: "trip_cancelled" } })).toBe(1);
  });

  it("preserves the passenger's confirmed participation after departure and keeps deleted inbox empty", async () => {
    const tripId = await createTrip();
    const bookingId = await book(tripId);
    await confirm(bookingId);
    await db.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 30 * 60_000) } });
    expect((await request("/api/v1/users/me", "DELETE", passenger)).status).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("confirmed");
    expect((await request(`/api/v1/trips/${tripId}/complete`, "PATCH", driver)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: passenger } })).tripsCount).toBe(0);
    expect(await db.notification.count({ where: { userId: passenger } })).toBe(0);
  });

  it("completes an already-departed driver's trip while preserving passenger history", async () => {
    const tripId = await createTrip();
    const bookingId = await book(tripId);
    await confirm(bookingId);
    await db.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 30 * 60_000) } });
    expect((await request("/api/v1/users/me", "DELETE", driver)).status).toBe(200);
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe("completed");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("confirmed");
    expect((await db.user.findUniqueOrThrow({ where: { id: passenger } })).tripsCount).toBe(1);
  });

  it("hides a banned driver from search and rejects new reservations while preserving old obligations", async () => {
    const tripId = await createTrip();
    const existing = await book(tripId);
    await confirm(existing);
    expect((await request(`/api/v1/admin/users/${driver}/ban`, "PATCH", undefined, { reason: "Release regression" }, true)).status).toBe(200);
    const stranger = (await seedTelegramUser()).id;
    actorIds.push(stranger);
    const list = await (await request(`/api/v1/trips?fromCityId=${from.id}`, "GET", stranger)).json() as { items: unknown[] };
    expect(list.items).toHaveLength(0);
    expect((await request("/api/v1/bookings", "POST", stranger, { tripId, seat: 2 })).status).toBe(404);
    expect((await request(`/api/v1/trips/${tripId}`, "GET", passenger)).status).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: existing } })).status).toBe("confirmed");
  });
});

describe("release regressions: events, search and travel obligations", () => {
  it("persists two distinct bookings even when their notification text matches", async () => {
    const first = await createTrip();
    const second = await createTrip(driver, new Date(departure.getTime() + 24 * 3_600_000));
    const secondPassenger = (await seedTelegramUser()).id;
    actorIds.push(secondPassenger);
    await book(first);
    await book(second, secondPassenger);
    expect(await db.notification.count({ where: { userId: driver, type: "booking_created" } })).toBe(2);
    expect(await db.notificationDelivery.count({ where: { userId: driver, type: "booking_created" } })).toBe(2);
  });

  it("persists cancellation for an offline driver even with optional notifications disabled", async () => {
    const id = await book(await createTrip());
    await db.user.update({ where: { id: driver }, data: { notificationsEnabled: false } });
    expect((await request(`/api/v1/bookings/${id}/cancel`, "PATCH", passenger)).status).toBe(200);
    expect(await db.notification.findFirst({ where: { userId: driver, type: "booking_status_changed" } })).toMatchObject({ action: "cancelled", recipientRole: "driver" });
    expect(await db.notificationDelivery.count({ where: { userId: driver, type: "booking_status_changed" } })).toBe(1);
  });

  it("keeps trip search linked to the city ID after renaming", async () => {
    const id = await createTrip();
    expect((await request(`/api/v1/admin/cities/${from.id}`, "PATCH", undefined, { name: `${from.name} renamed` }, true)).status).toBe(200);
    const response = await request(`/api/v1/trips?fromCityId=${from.id}`, "GET", passenger);
    const result = await response.json() as { items: Array<{ id: string }> };
    expect(result.items.map(t => t.id)).toEqual([id]);
  });

  it("returns a controlled conflict when a city is still referenced by a ride request", async () => {
    const response = await request("/api/v1/ride-requests", "POST", passenger, {
      fromCityId: from.id, toCityId: to.id, earliestAt: departure.toISOString(),
      latestAt: new Date(departure.getTime() + 3_600_000).toISOString(),
      expiresAt: new Date(departure.getTime() + 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    const deletion = await request(`/api/v1/admin/cities/${from.id}`, "DELETE", undefined, undefined, true);
    expect(deletion.status).toBe(409);
    expect(await deletion.json()).toMatchObject({ code: "CONFLICT" });
    expect(await db.city.findUnique({ where: { id: from.id } })).not.toBeNull();
  });

  it("does not fulfill a ride request while its reservation is pending or declined", async () => {
    const response = await request("/api/v1/ride-requests", "POST", passenger, {
      fromCityId: from.id, toCityId: to.id, earliestAt: departure.toISOString(),
      latestAt: new Date(departure.getTime() + 3_600_000).toISOString(),
      expiresAt: new Date(departure.getTime() + 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    const { id: requestId } = await response.json() as { id: string };
    const tripId = await createTrip();
    const bookingId = await book(tripId);
    expect((await db.rideRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("active");
    expect((await request(`/api/v1/bookings/${bookingId}/status`, "PATCH", driver, { status: "declined" })).status).toBe(200);
    expect((await db.rideRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("active");
    const replacement = await book(tripId);
    await confirm(replacement);
    expect((await db.rideRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("fulfilled");
  });

  it("prevents a driver from becoming a passenger on an overlapping trip", async () => {
    await createTrip();
    await seedCar(passenger);
    const other = await createTrip(passenger);
    const response = await request("/api/v1/bookings", "POST", driver, { tripId: other, seat: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PASSENGER_BOOKING_OVERLAP" });
  });

  it("prevents a passenger from publishing or moving a trip into an existing reservation", async () => {
    await book(await createTrip());
    await seedCar(passenger);
    expect((await request("/api/v1/trips", "POST", passenger, tripBody())).status).toBe(409);
    const own = await createTrip(passenger, new Date(departure.getTime() + 24 * 3_600_000));
    expect((await request(`/api/v1/trips/${own}`, "PATCH", passenger, { departureAt: departure.toISOString() })).status).toBe(409);
  });

  it("checks a passenger's own driving commitments when the driver reschedules", async () => {
    const tripId = await createTrip();
    await book(tripId);
    await seedCar(passenger);
    const later = new Date(departure.getTime() + 24 * 3_600_000);
    await createTrip(passenger, later);
    const response = await request(`/api/v1/trips/${tripId}`, "PATCH", driver, { departureAt: later.toISOString() });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PASSENGER_BOOKING_OVERLAP" });
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).departureAt).toEqual(departure);
  });

  it("fulfills the search atomically when an administrator confirms a pending booking", async () => {
    const response = await request("/api/v1/ride-requests", "POST", passenger, {
      fromCityId: from.id, toCityId: to.id, earliestAt: departure.toISOString(),
      latestAt: new Date(departure.getTime() + 3_600_000).toISOString(),
      expiresAt: new Date(departure.getTime() + 3_600_000).toISOString(),
    });
    expect(response.status).toBe(201);
    const { id: requestId } = await response.json() as { id: string };
    const bookingId = await book(await createTrip());
    expect((await db.rideRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("active");
    expect((await request(`/api/v1/admin/bookings/${bookingId}/status`, "PATCH", undefined, { status: "confirmed" }, true)).status).toBe(200);
    expect((await db.rideRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("fulfilled");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).requestId).toBe(requestId);
  });

  it("notifies confirmed passengers when duration or conditions change", async () => {
    const tripId = await createTrip();
    await confirm(await book(tripId));
    expect((await request(`/api/v1/trips/${tripId}`, "PATCH", driver, { durationMinutes: 180, comment: "New conditions" })).status).toBe(200);
    expect(await db.notification.findFirst({ where: { userId: passenger, type: "trip_details_changed" } })).toMatchObject({ action: "changed" });
  });

  it("preserves /start consent before the first Mini App login", async () => {
    const tgId = nextTelegramId();
    const response = await request(`/bot/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`, "POST", undefined, {
      message: { from: { id: Number(tgId) }, chat: { id: Number(tgId), type: "private" }, text: "/start" },
    });
    expect(response.status).toBe(200);
    const stub = await db.user.findUnique({ where: { telegramUserId: tgId } });
    if (stub) actorIds.push(stub.id);
    const login = await telegramLogin(app, tgId);
    expect((await db.user.findUniqueOrThrow({ where: { id: login.userId } })).tgChatJoinedAt).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: login.userId } })).name).toBe("Паритет");
  });
});
