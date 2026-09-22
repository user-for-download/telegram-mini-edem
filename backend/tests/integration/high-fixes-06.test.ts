import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * high-fixes-06: Trip DTO bounds + review P2034→409 + booking sanitizer.
 *
 * 1. Trip DTO: durationMinutes/distanceKm получили верхние границы
 *    (contracts/dto/trip.dto.ts) — зеркало клиентской валидации мини-апа
 *    (CreateTripModal: часы ≤168 → минуты ≤10080; расстояние ≤20000 км).
 *    Oversize-payload → 400. seatsTotal/MAX_SEATS НЕ тронуты (F1: MAX_SEATS=3).
 * 2. Review P2034: повторный SSI-конфликт в POST /reviews → 409 CONFLICT
 *    с retryable:true, never 503 (security-audit §4). Параллельные
 *    дубли отзывов: ровно один 201, проигравший 409, одна строка, без 5xx.
 * 3. Booking-status: PATCH /:id/status идёт через getSanitizedBody
 *    (был прямой c.req.json — обход санитайзера, security-audit §2).
 *    Неизвестный статус → 400 без изменения состояния брони.
 *
 * Паттерны репо (booking-conflicts.test.ts, trip-city-id.test.ts,
 * review-moderation.test.ts): app.request(), dev-авторизация mock-токеном,
 * уникальные telegramUserId, очистка в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

// telegramUserId — BigInt: диапазон 9_710_000+ не пересекается с другими suites.
let tgSeq = 9_710_000n;

async function ensureCity(name: string): Promise<string> {
  const nameNormalized = name.trim().toLowerCase();
  const existing = await db.city.findFirst({ where: { nameNormalized } });
  if (existing) return existing.id;
  const created = await db.city.create({ data: { name, nameNormalized } });
  return created.id;
}

async function createDriver(): Promise<string> {
  const seq = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `hf06-driver-${seq}`,
      telegramUserId: seq,
      avatar: "https://i.pravatar.cc/200?img=1",
    },
  });
  await db.car.create({
    data: { userId: user.id, model: "Test", color: "white", plate: `HF${seq}` },
  });
  return user.id;
}

async function createPassenger(): Promise<string> {
  const seq = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `hf06-passenger-${seq}`,
      telegramUserId: seq,
      avatar: "https://i.pravatar.cc/200?img=9",
    },
  });
  return user.id;
}

function validTripPayload(fromCityId: string, toCityId: string) {
  return {
    fromCity: "Москва-hf06",
    fromAddress: "Тверская 1",
    toCity: "Тула-hf06",
    toAddress: "пр-т Ленина",
    fromCityId,
    toCityId,
    departureAt: "2030-08-01T10:00:00Z",
    durationMinutes: 130,
    distanceKm: 165,
    price: 500,
    seatsTotal: 3,
    tags: [],
  };
}

describe("high-fixes-06: trip DTO bounds", () => {
  let driverId: string;
  let fromCityId: string;
  let toCityId: string;

  beforeEach(async () => {
    driverId = await createDriver();
    fromCityId = await ensureCity("Москва-hf06");
    toCityId = await ensureCity("Тула-hf06");
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { trip: { driverId } } });
    await db.review.deleteMany({ where: { trip: { driverId } } });
    await db.trip.deleteMany({ where: { driverId } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: driverId } });
  });

  function postTrip(payload: unknown): Promise<Response> {
    return app.request("/api/v1/trips", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify(payload),
    });
  }

  it("rejects oversize durationMinutes with 400", async () => {
    const res = await postTrip({
      ...validTripPayload(fromCityId, toCityId),
      durationMinutes: 20000,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe("Invalid payload");
  });

  it("rejects oversize distanceKm with 400", async () => {
    const res = await postTrip({
      ...validTripPayload(fromCityId, toCityId),
      distanceKm: 50000,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe("Invalid payload");
  });

  it("rejects oversize price with 400 (pre-existing bound, regression guard)", async () => {
    const res = await postTrip({
      ...validTripPayload(fromCityId, toCityId),
      price: 200000,
    });
    expect(res.status).toBe(400);
  });

  it("keeps seatsTotal bound at MAX_SEATS=3 (untouched by this fix)", async () => {
    const res = await postTrip({
      ...validTripPayload(fromCityId, toCityId),
      seatsTotal: 4,
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid payload (control: 201)", async () => {
    const res = await postTrip(validTripPayload(fromCityId, toCityId));
    expect(res.status).toBe(201);
  });

  it("rejects oversize durationMinutes on PATCH /trips/:id with 400", async () => {
    const created = await postTrip(validTripPayload(fromCityId, toCityId));
    expect(created.status).toBe(201);
    const trip = await created.json();

    const res = await app.request(`/api/v1/trips/${trip.id}`, {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify({ durationMinutes: 20000 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("high-fixes-06: concurrent review writes → 409, never 5xx", () => {
  let driverId: string;
  let passengerId: string;
  let tripId: string;

  beforeEach(async () => {
    driverId = await createDriver();
    passengerId = await createPassenger();
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва-hf06",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула-hf06",
        toAddress: "пр-т Ленина",
        departureAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
        status: "completed",
      },
    });
    tripId = trip.id;
    await db.booking.create({
      data: { tripId, passengerId, seat: 1, status: "confirmed" },
    });
  });

  afterEach(async () => {
    await db.review.deleteMany({ where: { tripId } });
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: { in: [driverId, passengerId] } } });
  });

  function postReview(): Promise<{ status: number; body: unknown }> {
    return app
      .request("/api/v1/reviews", {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          Authorization: `Bearer ${devMockAccessToken(passengerId)}`,
        },
        body: JSON.stringify({
          tripId,
          targetUserId: driverId,
          rating: 5,
          text: "Отличная поездка!",
        }),
      })
      .then(async (res) => ({ status: res.status, body: await res.json() }));
  }

  it("concurrent identical reviews: exactly one wins, loser gets 409, one row, no 5xx", async () => {
    const [r1, r2] = await Promise.all([postReview(), postReview()]);

    // Победитель всегда 201; проигравший — 409 (pre-check ALREADY_REVIEWED,
    // P2002 по Review_authorId_tripId_targetUserId_key либо P2034
    // SSI-конфликт → CONFLICT retryable). 503 INTERNAL_ERROR запрещён.
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);
    for (const r of [r1, r2]) {
      expect(r.status).toBeLessThan(500);
    }
    const loser = r1.status === 409 ? r1 : r2;
    expect(["ALREADY_REVIEWED", "CONFLICT"]).toContain(loser.body.code);
    if (loser.body.code === "CONFLICT") {
      expect(loser.body.retryable).toBe(true);
    }

    const count = await db.review.count({
      where: { authorId: passengerId, tripId, targetUserId: driverId },
    });
    expect(count).toBe(1);
  });
});

describe("high-fixes-06: booking-status sanitizer", () => {
  let driverId: string;
  let passengerId: string;
  let tripId: string;
  let bookingId: string;

  beforeEach(async () => {
    driverId = await createDriver();
    passengerId = await createPassenger();
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва-hf06",
        fromAddress: "Тверская 1",
        toCity: "Тула-hf06",
        toAddress: "Невский 1",
        departureAt: new Date("2030-06-01T09:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
    const booking = await db.booking.create({
      data: { tripId, passengerId, seat: 1, status: "pending" },
    });
    bookingId = booking.id;
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: { in: [driverId, passengerId] } } });
  });

  function patchStatus(payload: unknown): Promise<Response> {
    return app.request(`/api/v1/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async function dbStatus(): Promise<string | null> {
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    return booking?.status ?? null;
  }

  it("rejects unknown status with 400 and leaves the booking untouched", async () => {
    const res = await patchStatus({ status: "archived" });
    expect(res.status).toBe(400);
    expect(await dbStatus()).toBe("pending");
  });

  it("rejects driver-forbidden status with 400 and leaves the booking untouched", async () => {
    const res = await patchStatus({ status: "cancelled" });
    expect(res.status).toBe(400);
    expect(await dbStatus()).toBe("pending");
  });

  it("rejects empty payload with 400 and leaves the booking untouched", async () => {
    const res = await patchStatus({});
    expect(res.status).toBe(400);
    expect(await dbStatus()).toBe("pending");
  });

  it("confirms with a valid status (control: 200)", async () => {
    const res = await patchStatus({ status: "confirmed" });
    expect(res.status).toBe(200);
    expect(await dbStatus()).toBe("confirmed");
  });
});
