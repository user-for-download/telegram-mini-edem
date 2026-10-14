import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Регресс на рассинхрон partial-unique-индекса и activeBookingWhere():
 *
 * `active_seat_booking` уникален по (tripId, seat) при
 * `status IN ('pending','confirmed')`, а код считает активной только
 * НЕистёкшую pending. Глобальный in-tx sweep берёт лишь топ-20 старейших
 * просрочек, поэтому просроченный pending конкретной поездки мог остаться
 * и держать индекс. Тогда чужой пассажир получал ложный 409 SEAT_TAKEN.
 *
 * Фикс — адресный добор `releaseExpiredBookings(tx, now, { tripId })`.
 * Чтобы воспроизвести, «забиваем» топ-20 просрочками на ДРУГИХ поездках
 * (более старыми по expiresAt), чем вытесняем просрочку целевой поездки из
 * глобального окна.
 *
 * Паттерн репо: реальная БД, прямые фикстуры, явная уборка.
 */
describe("POST /bookings — просроченный pending вне глобального sweep", () => {
  let driverId: string;
  let blockerId: string;
  let passengerId: string;
  let sweeperIds: string[];
  let targetTripId: string;
  const otherTripIds: string[] = [];
  const createdUserIds: string[] = [];
  let tgSeq = 8_400_000n;

  async function createUser(name: string): Promise<string> {
    const user = await db.user.create({
      data: { name, telegramUserId: ++tgSeq, avatar: "" },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createTrip(
    ownerId: string,
    seatsAvailable: number,
  ): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId: ownerId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable,
        tags: [],
      },
    });
    return trip.id;
  }

  beforeEach(async () => {
    driverId = await createUser(`ExpDriver ${Date.now()}`);
    blockerId = await createUser(`ExpBlocker ${Date.now()}`);
    passengerId = await createUser(`ExpPassenger ${Date.now()}`);
    // active_passenger_booking уникален по (tripId, passengerId) → на каждое
    // место слотовой фикстуры нужен свой пассажир.
    sweeperIds = await Promise.all([
      createUser(`ExpSweeperA ${Date.now()}`),
      createUser(`ExpSweeperB ${Date.now()}`),
      createUser(`ExpSweeperC ${Date.now()}`),
    ]);

    // Целевая поездка: место 1 держит ПРОСРОЧЕННЫЙ pending (самый свежий по
    // expiresAt среди всех фикстур), seatsAvailable уже уменьшен на 1.
    targetTripId = await createTrip(driverId, 2);
    await db.booking.create({
      data: {
        tripId: targetTripId,
        passengerId: blockerId,
        seat: 1,
        status: "pending",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    // 21 просрочка на других поездках (7 × 3 мест), каждая СТАРШЕ целевой:
    // глобальный sweep top-20 заберёт только их и «не дойдёт» до целевой.
    for (let i = 0; i < 7; i += 1) {
      const tripId = await createTrip(driverId, 0);
      otherTripIds.push(tripId);
      for (let seat = 1; seat <= 3; seat += 1) {
        const idx = i * 3 + seat;
        await db.booking.create({
          data: {
            tripId,
            passengerId: sweeperIds[seat - 1],
            seat,
            status: "pending",
            expiresAt: new Date(Date.now() - 3_600_000 - idx * 1000),
          },
        });
      }
    }
  });

  afterEach(async () => {
    await db.booking.deleteMany({
      where: { tripId: { in: [targetTripId, ...otherTripIds] } },
    });
    await db.trip.deleteMany({
      where: { id: { in: [targetTripId, ...otherTripIds] } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    otherTripIds.length = 0;
    createdUserIds.length = 0;
  });

  it("чужой пассажир получает место, освобождённое просрочкой вне sweep (201, не 409)", async () => {
    const res = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devMockAccessToken(passengerId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tripId: targetTripId, seat: 1 }),
    });

    expect(res.status).toBe(201);

    // Просроченный pending целевой поездки освобождён адресным добором.
    const released = await db.booking.findFirst({
      where: { tripId: targetTripId, seat: 1, passengerId: blockerId },
    });
    expect(released?.status).toBe("declined");
  });
});
