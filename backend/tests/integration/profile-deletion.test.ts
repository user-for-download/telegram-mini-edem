import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

describe("DELETE /api/v1/users/me", () => {
  let userId: string;
  let driverId: string;
  let tripId: string;

  beforeEach(async () => {
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    const [user, driver] = await Promise.all([
      db.user.create({ data: { name: `Delete user ${suffix}`, telegramUserId: BigInt(6100000 + (suffix % 100000)), avatar: "", about: "about" } }),
      db.user.create({ data: { name: `Delete driver ${suffix}`, telegramUserId: BigInt(6200000 + (suffix % 100000)), avatar: "" } }),
    ]);
    userId = user.id;
    driverId = driver.id;
    const trip = await db.trip.create({ data: { driverId, fromCity: "Москва", fromAddress: "A", toCity: "Тула", toAddress: "B", departureAt: new Date("2030-01-01T10:00:00Z"), durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 3, tags: [] } });
    tripId = trip.id;
    await db.car.create({ data: { userId, model: "Test", color: "Black", plate: "A000AA" } });
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { passengerId: userId } });
    await db.rideRequest.deleteMany({ where: { userId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.car.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: { in: [userId, driverId] } } });
  });

  it("anonymizes the account and invalidates required auth", async () => {
    const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
    expect(response.status).toBe(200);
    const deleted = await db.user.findUnique({ where: { id: userId }, include: { car: true } });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.telegramUserId).not.toBeNull();
    expect(deleted?.name).toBe("Удалённый пользователь");
    expect(deleted?.car).toBeNull();
    const after = await app.request("/api/v1/users/me", { headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
    expect(after.status).toBe(403);
  });

  it("completes own active trips on deletion (pending declined, confirmed kept)", async () => {
    const ownTrip = await db.trip.create({ data: { driverId: userId, fromCity: "Москва", fromAddress: "A", toCity: "Тула", toAddress: "B", departureAt: new Date("2030-01-01T10:00:00Z"), durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 1, tags: [] } });
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    // active_passenger_booking: одна активная бронь на связку
    // (поездка, пассажир) — pending и confirmed у разных пассажиров.
    const [paxPending, paxConfirmed] = await Promise.all([
      db.user.create({ data: { name: `PaxP ${suffix}`, telegramUserId: BigInt(6300000 + (suffix % 100000)), avatar: "" } }),
      db.user.create({ data: { name: `PaxC ${suffix}`, telegramUserId: BigInt(6400000 + (suffix % 100000)), avatar: "" } }),
    ]);
    await db.booking.create({ data: { tripId: ownTrip.id, passengerId: paxPending.id, seat: 1, status: "pending" } });
    await db.booking.create({ data: { tripId: ownTrip.id, passengerId: paxConfirmed.id, seat: 2, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
      const trip = await db.trip.findUnique({ where: { id: ownTrip.id } });
      expect(trip?.status).toBe("completed");
      expect(trip?.seatsAvailable).toBe(0);
      const bookings = await db.booking.findMany({ where: { tripId: ownTrip.id } });
      expect(bookings.find((b) => b.seat === 1)?.status).toBe("declined");
      expect(bookings.find((b) => b.seat === 2)?.status).toBe("confirmed");
      const confirmedAfter = await db.user.findUnique({ where: { id: paxConfirmed.id } });
      expect(confirmedAfter?.tripsCount).toBe(1);
      const tombstone = await db.user.findUnique({ where: { id: userId } });
      expect(tombstone?.deletedAt).not.toBeNull();
    } finally {
      await db.booking.deleteMany({ where: { tripId: ownTrip.id } });
      await db.trip.delete({ where: { id: ownTrip.id } });
      await db.user.deleteMany({ where: { id: { in: [paxPending.id, paxConfirmed.id] } } });
    }
  });

  it("cancels own bookings on active trips on deletion (seat restored)", async () => {
    await db.trip.update({ where: { id: tripId }, data: { seatsAvailable: 2 } });
    const booking = await db.booking.create({ data: { tripId, passengerId: userId, seat: 1, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
      const cancelled = await db.booking.findUnique({ where: { id: booking.id } });
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.cancelledByType).toBe("user");
      const trip = await db.trip.findUnique({ where: { id: tripId } });
      expect(trip?.seatsAvailable).toBe(3);
    } finally {
      await db.booking.delete({ where: { id: booking.id } });
    }
  });

  it("allows deletion with bookings only on completed trips (history)", async () => {
    await db.trip.update({ where: { id: tripId }, data: { status: "completed" } });
    await db.booking.create({ data: { tripId, passengerId: userId, seat: 1, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
    } finally {
      await db.booking.deleteMany({ where: { passengerId: userId } });
    }
  });

  it("does not recreate a deleted account on the same Telegram identity", async () => {
    const telegramUserId = (
      await db.user.findUnique({ where: { id: userId }, select: { telegramUserId: true } })
    )?.telegramUserId;
    expect(telegramUserId).not.toBeNull();
    const deletion = await app.request("/api/v1/users/me", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` },
    });
    expect(deletion.status).toBe(200);
    const initData = new URLSearchParams([
      ["user", JSON.stringify({ id: Number(telegramUserId), first_name: "Del" })],
      ["auth_date", String(Math.floor(Date.now() / 1000))],
      ["hash", "dev-hash"],
    ]).toString();
    const response = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Account is deleted");
    expect(await db.user.count({ where: { telegramUserId } })).toBe(1);
  });
});
