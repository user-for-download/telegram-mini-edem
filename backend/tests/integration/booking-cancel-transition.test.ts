import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Регресс: отмена брони в терминальном статусе (declined/cancelled)
 * возвращала 400, хотя нелегальный переход статуса — это 409 CONFLICT
 * (как в PATCH /bookings/:id/status, см. src/bookings/status.ts).
 */
describe("PATCH /bookings/:id/cancel — illegal transition", () => {
  let passengerId: string;
  let driverId: string;
  let tripId: string;
  let bookingId: string;

  beforeEach(async () => {
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    const [passenger, driver] = await Promise.all([
      db.user.create({
        data: {
          name: `CancelPax-${suffix}`,
          telegramUserId: BigInt(7100000 + (suffix % 100000)),
          avatar: "",
        },
      }),
      db.user.create({
        data: {
          name: `CancelDrv-${suffix}`,
          telegramUserId: BigInt(7200000 + (suffix % 100000)),
          avatar: "",
        },
      }),
    ]);
    passengerId = passenger.id;
    driverId = driver.id;

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date("2030-01-01T10:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
      },
    });
    tripId = trip.id;

    const booking = await db.booking.create({
      data: {
        tripId,
        passengerId,
        seat: 1,
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledByType: "user",
        cancellationReason: "test",
      },
    });
    bookingId = booking.id;
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: [passengerId, driverId] } } });
  });

  it("already-cancelled → 409 CONFLICT (не 400)", async () => {
    const res = await app.request(`/api/v1/bookings/${bookingId}/cancel`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${devMockAccessToken(passengerId)}` },
    });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CONFLICT");
  });
});
