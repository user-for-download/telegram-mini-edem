import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Отмена УЖЕ УЕХАВШЕЙ поездки.
 *
 * Регресс: `/trips/:id/cancel` проверял только `status === "active"`, а
 * автоархив наступает лишь через 24ч после отправления (`bookings/shared.ts`).
 * В это окно водитель мог отменить рейс в пути: confirmed-брони пассажиров
 * переводились в `cancelled` ПОСЛЕ поездки (пассажиру приходило «Поездка
 * отменена» в дороге), а `cancelled` попрежнему закрывает отзыв
 * (`bookings/queries.ts` → canReview), то есть отзыв терялся навсегда.
 *
 * Тот же запрет уже стоит в PATCH /trips/:id и в /complete — отправление
 * точка невозврата, и отмена не должна быть исключением.
 *
 * Админская отмена (PATCH /admin/trips/:id/cancel) — отдельный путь
 * модерации и этого гейта не имеет намеренно.
 */
describe("trip cancel: уехавшую поездку отменить нельзя", () => {
  // BigInt-счётчик: Date.now() выходит за 32 бита.
  let tgSeq = 3_700_000n;
  let driverId: string;
  let passengerId: string;
  let tripId: string;
  let bookingId: string;

  async function createUser(name: string): Promise<string> {
    const user = await db.user.create({
      data: {
        name: `${name}-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=7",
      },
    });
    return user.id;
  }

  async function createTrip(
    driver: string,
    departureAt: Date,
  ): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId: driver,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt,
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    return trip.id;
  }

  beforeEach(async () => {
    driverId = await createUser("DepartedDriver");
    passengerId = await createUser("DepartedPassenger");

    await db.car.create({
      data: {
        userId: driverId,
        model: "Tesla",
        color: "Black",
        plate: `А001АА${Number(tgSeq % 100n)}`,
      },
    });

    // Отправление час назад, но status ещё `active`: ровно то окно, в котором
    // гейт отсутствовал.
    tripId = await createTrip(driverId, new Date(Date.now() - 60 * 60 * 1000));

    const booking = await db.booking.create({
      data: {
        tripId,
        passengerId,
        seat: 1,
        status: "confirmed",
        comment: "Бронь уехавшей поездки",
      },
    });
    bookingId = booking.id;
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.notification.deleteMany({
      where: { userId: { in: [driverId, passengerId] } },
    });
    await db.trip.deleteMany({ where: { driverId } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: { in: [driverId, passengerId] } } });
  });

  it("возвращает 409 TRIP_IN_PAST и не отменяет поездку", async () => {
    const res = await app.request(`/api/v1/trips/${tripId}/cancel`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("TRIP_IN_PAST");

    const dbTrip = await db.trip.findUnique({ where: { id: tripId } });
    expect(dbTrip?.status).toBe("active");
    expect(dbTrip?.cancelledAt).toBeNull();
    // Главное: бронь пассажира не ломается после состоявшейся поездки.
    const dbBooking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking?.status).toBe("confirmed");
  });

  it("не отправляет пассажиру ложное «Поездка отменена»", async () => {
    await app.request(`/api/v1/trips/${tripId}/cancel`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });

    const notifications = await db.notification.findMany({
      where: { userId: passengerId },
    });
    expect(notifications).toHaveLength(0);
  });

  it("будущую поездку отменить по-прежнему можно", async () => {
    const futureTripId = await createTrip(
      driverId,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    try {
      const res = await app.request(`/api/v1/trips/${futureTripId}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
      });

      expect(res.status).toBe(200);
      const dbTrip = await db.trip.findUnique({ where: { id: futureTripId } });
      expect(dbTrip?.status).toBe("cancelled");
    } finally {
      await db.booking.deleteMany({ where: { tripId: futureTripId } });
      await db.trip.deleteMany({ where: { id: futureTripId } });
    }
  });
});
