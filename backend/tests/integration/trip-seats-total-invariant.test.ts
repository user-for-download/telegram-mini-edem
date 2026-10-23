import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Согласованность `seatsAvailable` и `bookedSeats` в ответах о поездке.
 *
 * Инвариант, на который опирается весь учёт мест:
 *   `seatsAvailable == seatsTotal - <число строк pending/confirmed>`.
 * Его поддерживают парные события (create: −1; release/cancel: +1), а
 * `bookedSeats` в списке (`getActiveBookingSeatsByTripIds`) считается по тем
 * же статусам. Редактирование `seatsTotal` ПЕРЕсчитывает `seatsAvailable` —
 * и до фикса брало «логический» (expiry-aware) счётчик, не совпадающий с
 * DB-учётом: просроченный pending держит декремент, но не попадал в счёт →
 * `seatsAvailable` раздувался, а в одном ответе `seatsAvailable` и
 * `bookedSeats` противоречили друг другу.
 *
 * Паттерн репо: реальная БД, прямые фикстуры, явная уборка.
 */
describe("PATCH /trips/:id (seatsTotal) — инвариант учёта мест", () => {
  let driverId: string;
  let passengerId: string;
  let tripId: string;
  const createdUserIds: string[] = [];
  let tgSeq = 8_500_000n;

  beforeEach(async () => {
    const driver = await db.user.create({
      data: { name: `SeatsDriver ${Date.now()}`, telegramUserId: ++tgSeq, avatar: "" },
    });
    driverId = driver.id;
    createdUserIds.push(driver.id);

    const passenger = await db.user.create({
      data: { name: `SeatsPax ${Date.now()}`, telegramUserId: ++tgSeq, avatar: "" },
    });
    passengerId = passenger.id;
    createdUserIds.push(passenger.id);

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "A",
        toCity: "Тула",
        toAddress: "B",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
      },
    });
    tripId = trip.id;

    // Просроченный pending: место удержано в БД (декремент не откатан),
    // но логически уже не активно.
    await db.booking.create({
      data: {
        tripId,
        passengerId,
        seat: 1,
        status: "pending",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  it("правка seatsTotal сохраняет учёт мест: seatsAvailable = seatsTotal − удержанные места", async () => {
    const res = await app.request(`/api/v1/trips/${tripId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ seatsTotal: 3 }),
    });
    expect(res.status).toBe(200);

    // Просроченный pending всё ещё держит место (строка pending), поэтому
    // свободно должно остаться 2, а не 3.
    const trip = await db.trip.findUnique({ where: { id: tripId } });
    expect(trip?.seatsAvailable).toBe(2);
  });

  it("ответ списка не противоречит сам себе: seatsAvailable + bookedSeats.length = seatsTotal", async () => {
    await app.request(`/api/v1/trips/${tripId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ seatsTotal: 3 }),
    });

    const listRes = await app.request("/api/v1/trips?limit=50", {
      headers: {
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
    });
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      items: Array<{ id: string; seatsTotal: number; seatsAvailable: number; bookedSeats: number[] }>;
    };
    const item = body.items.find((t) => t.id === tripId);
    expect(item).toBeDefined();
    expect(item!.seatsAvailable + item!.bookedSeats.length).toBe(item!.seatsTotal);
  });
});
