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

  it("blocks deletion while the user has an active trip obligation", async () => {

    const ownTrip = await db.trip.create({ data: { driverId: userId, fromCity: "Москва", fromAddress: "A", toCity: "Тула", toAddress: "B", departureAt: new Date("2030-01-01T10:00:00Z"), durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 3, tags: [] } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("ACCOUNT_HAS_ACTIVE_OBLIGATIONS");
    } finally {
      await db.trip.delete({ where: { id: ownTrip.id } });
    }
  });

  it("blocks deletion while the user has a booking on an active trip", async () => {
    const booking = await db.booking.create({ data: { tripId, passengerId: userId, seat: 1, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("ACCOUNT_HAS_ACTIVE_OBLIGATIONS");
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
