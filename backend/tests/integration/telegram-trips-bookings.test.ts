import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Telegram trips/bookings parity (tg-migration-12): гонки за места,
 * уехавшие поездки, владение (ownership) и deep-link доступ.
 *
 * Бэкенд — авторитет и не меняется: тест фиксирует только существующее
 * поведение, на которое опирается telegram-app (seat selector, expired-
 * состояния, 403 для чужих заявок, публичные детали по диплинку).
 *
 * Паттерны репо (см. booking-conflicts.test.ts, trips-lifecycle.test.ts):
 * app.request() вместо supertest, dev-авторизация mock-токеном,
 * уникальные telegramUserId (INT4-счётчик).
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

describe("Telegram trips/bookings parity (existing backend)", () => {
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  let tgSeq = 7_100_000n;
  let driverId: string;
  let passenger1Id: string;
  let passenger2Id: string;
  let strangerId: string;
  let tripId: string;

  async function createUser(name: string): Promise<string> {
    const user = await db.user.create({
      data: {
        name: `${name}-${tgSeq + 1n}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });
    return user.id;
  }

  async function createTrip(
    driver: string,
    departureAt = new Date("2030-06-01T09:00:00Z"),
  ): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId: driver,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt,
        durationMinutes: 150,
        distanceKm: 180,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    return trip.id;
  }

  function auth(userId?: string): Record<string, string> {
    return userId ? { Authorization: `Bearer ${devMockAccessToken(userId)}` } : {};
  }

  async function book(passengerId: string, trip: string, seat: number) {
    const res = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(passengerId) },
      body: JSON.stringify({ tripId: trip, seat }),
    });
    return { status: res.status, body: (await res.json()) as { code?: string; id?: string; seat?: number } };
  }

  beforeEach(async () => {
    driverId = await createUser("TgDriver");
    passenger1Id = await createUser("TgPassenger1");
    passenger2Id = await createUser("TgPassenger2");
    strangerId = await createUser("TgStranger");
    tripId = await createTrip(driverId);
  });

  afterEach(async () => {
    await db.booking.deleteMany({
      where: { passengerId: { in: [passenger1Id, passenger2Id, strangerId] } },
    });
    await db.trip.deleteMany({ where: { driverId } });
    await db.user.deleteMany({
      where: { id: { in: [driverId, passenger1Id, passenger2Id, strangerId] } },
    });
  });

  it("seat race: exactly one booking wins, loser gets 409 SEAT_TAKEN", async () => {
    const [first, second] = await Promise.all([
      book(passenger1Id, tripId, 1),
      book(passenger2Id, tripId, 1),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toContain(201);
    const loser = first.status === 201 ? second : first;
    expect(loser.status).toBe(409);
    expect(loser.body.code).toBe("SEAT_TAKEN");

    const count = await db.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  it("rejects booking of an expired (departed) trip with 400 TRIP_IN_PAST", async () => {
    const departedId = await createTrip(driverId, new Date(Date.now() - 3_600_000));
    try {
      const { status, body } = await book(passenger1Id, departedId, 1);
      expect(status).toBe(400);
      expect(body.code).toBe("TRIP_IN_PAST");
    } finally {
      await db.booking.deleteMany({ where: { tripId: departedId } });
      await db.trip.deleteMany({ where: { id: departedId } });
    }
  });

  it("enforces ownership: stranger cannot cancel, edit or complete the trip", async () => {
    const cancel = await app.request(`/api/v1/trips/${tripId}/cancel`, {
      method: "PATCH",
      headers: auth(strangerId),
    });
    expect(cancel.status).toBe(403);

    const edit = await app.request(`/api/v1/trips/${tripId}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...auth(strangerId) },
      body: JSON.stringify({ price: 999 }),
    });
    expect(edit.status).toBe(403);

    // Завершить будущую поездку нельзя даже владельцу (только после отправления).
    const complete = await app.request(`/api/v1/trips/${tripId}/complete`, {
      method: "PATCH",
      headers: auth(driverId),
    });
    expect(complete.status).toBe(400);
    expect(((await complete.json()) as { code?: string }).code).toBe("TRIP_IN_PAST");
  });

  it("restricts trip bookings to the driver (deep-link 403 for others)", async () => {
    const created = await book(passenger1Id, tripId, 1);
    expect(created.status).toBe(201);

    const stranger = await app.request(`/api/v1/bookings/trip/${tripId}`, {
      headers: auth(strangerId),
    });
    expect(stranger.status).toBe(403);

    const driver = await app.request(`/api/v1/bookings/trip/${tripId}`, {
      headers: auth(driverId),
    });
    expect(driver.status).toBe(200);
  });

  it("requires auth for personalized deep links and masks addresses from strangers", async () => {
    const pub = await app.request(`/api/v1/trips/${tripId}`);
    expect(pub.status).toBe(401);

    const missing = await app.request(
      "/api/v1/trips/00000000-0000-4000-8000-000000000000",
      { headers: auth(strangerId) },
    );
    expect(missing.status).toBe(404);

    const stranger = await app.request(`/api/v1/trips/${tripId}`, {
      headers: auth(strangerId),
    });
    const strangerBody = (await stranger.json()) as { fromAddress?: string };
    expect(strangerBody.fromAddress).toBeUndefined();

    const driver = await app.request(`/api/v1/trips/${tripId}`, {
      headers: auth(driverId),
    });
    const driverBody = (await driver.json()) as { fromAddress?: string };
    expect(driverBody.fromAddress).toBe("м. Тёплый Стан");
  });
});
