import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

const headers = (userId: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${devMockAccessToken(userId)}`,
});

// Детерминированные telegramUserId (audit: test isolation): монотонный счётчик
// вместо Math.random — повторы/параллельные прогоны не коллидируют, а
// «висящие» от упавшего clean-up строки видны по предсказуемому диапазону.
let tgSeq = 5_100_000n;

describe("Reports API", () => {
  let driverId: string;
  let passengerId: string;
  let tripId: string;
  let bookingId: string;
  let departureAt: Date;

  beforeEach(async () => {
    const users = await Promise.all([
      db.user.create({ data: { name: `Report driver ${tgSeq + 1n}`, telegramUserId: ++tgSeq, avatar: "" } }),
      db.user.create({ data: { name: `Report passenger ${tgSeq + 1n}`, telegramUserId: ++tgSeq, avatar: "" } }),
    ]);
    [driverId, passengerId] = users.map((user) => user.id);
    // Поездка в окне жалобы: началась 2 часа назад, длилась 2 часа —
    // значит закончилась 1 час назад, до верхней границы (7 дней) далеко.
    departureAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const trip = await db.trip.create({ data: { driverId, fromCity: "Москва", fromAddress: "Адрес 1", toCity: "Тула", toAddress: "Адрес 2", departureAt, durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 2, tags: [] } });
    tripId = trip.id;
    const booking = await db.booking.create({ data: { tripId, passengerId, seat: 1, status: "confirmed" } });
    bookingId = booking.id;
  });

  afterEach(async () => {
    await db.report.deleteMany({ where: { reporterId: { in: [driverId, passengerId] } } });
    await db.booking.deleteMany({ where: { id: bookingId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: [driverId, passengerId] } } });
  });

  it("creates and lists a report only for a related user", async () => {
    const create = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ targetType: "user", targetId: driverId, category: "safety", description: "  Небезопасное поведение  " }) });
    expect(create.status).toBe(201);
    expect((await create.json()).description).toBe("Небезопасное поведение");
    const list = await app.request("/api/v1/reports", { headers: headers(passengerId) });
    expect((await list.json())).toHaveLength(1);
  });

  it("rejects self reports and duplicate open reports", async () => {
    const self = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ targetType: "user", targetId: passengerId, category: "spam", description: "Сам на себя" }) });
    expect(self.status).toBe(403);
    const payload = { targetType: "booking", targetId: bookingId, category: "fraud", description: "Подозрительная бронь" };
    expect((await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify(payload) })).status).toBe(201);
    expect((await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify(payload) })).status).toBe(409);
  });

  it("rejects a driver report on their own trip", async () => {
    const response = await app.request("/api/v1/reports", { method: "POST", headers: headers(driverId), body: JSON.stringify({ targetType: "trip", targetId: tripId, category: "safety", description: "Жалоба на свою поездку" }) });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("rejects a report from an unrelated user", async () => {
    const unrelated = await db.user.create({ data: { name: "Unrelated", telegramUserId: ++tgSeq, avatar: "" } });
    try {
      const response = await app.request("/api/v1/reports", { method: "POST", headers: headers(unrelated.id), body: JSON.stringify({ targetType: "trip", targetId: tripId, category: "spam", description: "Не связан с поездкой" }) });
      expect(response.status).toBe(403);
    } finally {
      await db.user.delete({ where: { id: unrelated.id } });
    }
  });

  it("rejects a second report with a different category on the same target", async () => {
    const base = { targetType: "trip", targetId: tripId, description: "Проблема в поездке" };
    const first = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ ...base, category: "safety" }) });
    expect(first.status).toBe(201);
    const second = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ ...base, category: "fraud" }) });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("CONFLICT");
  });

  it("rejects a repeat report after the first one was resolved", async () => {
    const payload = { targetType: "trip", targetId: tripId, category: "safety", description: "Проблема в поездке" };
    const first = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify(payload) });
    expect(first.status).toBe(201);
    await db.report.updateMany({ where: { reporterId: passengerId, targetType: "trip", targetId: tripId }, data: { status: "resolved", resolvedAt: new Date() } });
    const repeat = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ ...payload, category: "spam" }) });
    expect(repeat.status).toBe(409);
  });

  it("allows only one report under concurrent creates (unique guard)", async () => {
    const payload = { targetType: "booking", targetId: bookingId, category: "spam", description: "Гонка жалоб" };
    const [a, b] = await Promise.all([
      app.request("/api/v1/reports", { method: "POST", headers: headers(driverId), body: JSON.stringify(payload) }),
      app.request("/api/v1/reports", { method: "POST", headers: headers(driverId), body: JSON.stringify(payload) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.report.count({ where: { reporterId: driverId, targetType: "booking", targetId: bookingId } })).toBe(1);
  });

  it("lists reportable targets: passenger gets trip, booking and driver", async () => {
    const response = await app.request("/api/v1/reports/targets", { headers: headers(passengerId) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { targetType: "trip", id: tripId, fromCity: "Москва", toCity: "Тула", departureAt: departureAt.toISOString() },
      { targetType: "booking", id: bookingId, fromCity: "Москва", toCity: "Тула", departureAt: departureAt.toISOString() },
      { targetType: "user", id: driverId, name: expect.any(String) },
    ]);
  });

  it("driver gets booking and passenger, but not their own trip", async () => {
    const response = await app.request("/api/v1/reports/targets", { headers: headers(driverId) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { targetType: "booking", id: bookingId, fromCity: "Москва", toCity: "Тула", departureAt: departureAt.toISOString() },
      { targetType: "user", id: passengerId, name: expect.any(String) },
    ]);
  });

  it("unrelated user gets an empty target list", async () => {
    const unrelated = await db.user.create({ data: { name: "No bookings", telegramUserId: ++tgSeq, avatar: "" } });
    try {
      const response = await app.request("/api/v1/reports/targets", { headers: headers(unrelated.id) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    } finally {
      await db.user.delete({ where: { id: unrelated.id } });
    }
  });

  const createTripWithBooking = async (departureAt: Date) => {
    const trip = await db.trip.create({ data: { driverId, fromCity: "Москва", fromAddress: "Адрес 1", toCity: "Тула", toAddress: "Адрес 2", departureAt, durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 2, tags: [] } });
    const booking = await db.booking.create({ data: { tripId: trip.id, passengerId, seat: 1, status: "confirmed" } });
    return { tripId: trip.id, bookingId: booking.id };
  };

  it("rejects a report on a trip that has not started yet", async () => {
    const future = await createTripWithBooking(new Date(Date.now() + 60 * 60 * 1000));
    try {
      const response = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ targetType: "trip", targetId: future.tripId, category: "safety", description: "Ещё не ехали" }) });
      expect(response.status).toBe(403);
    } finally {
      await db.booking.deleteMany({ where: { id: future.bookingId } });
      await db.trip.deleteMany({ where: { id: future.tripId } });
    }
  });

  it("rejects a report after the 7-day window", async () => {
    const old = await createTripWithBooking(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    try {
      const response = await app.request("/api/v1/reports", { method: "POST", headers: headers(passengerId), body: JSON.stringify({ targetType: "trip", targetId: old.tripId, category: "safety", description: "Слишком поздно" }) });
      expect(response.status).toBe(403);
    } finally {
      await db.booking.deleteMany({ where: { id: old.bookingId } });
      await db.trip.deleteMany({ where: { id: old.tripId } });
    }
  });

  it("omits out-of-window trips from the target list", async () => {
    const future = await createTripWithBooking(new Date(Date.now() + 60 * 60 * 1000));
    const old = await createTripWithBooking(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    try {
      const response = await app.request("/api/v1/reports/targets", { headers: headers(passengerId) });
      expect(response.status).toBe(200);
      expect(((await response.json()) as Array<{ id: string }>).map((target) => target.id)).toEqual([tripId, bookingId, driverId]);
    } finally {
      await db.booking.deleteMany({ where: { id: { in: [future.bookingId, old.bookingId] } } });
      await db.trip.deleteMany({ where: { id: { in: [future.tripId, old.tripId] } } });
    }
  });
});
