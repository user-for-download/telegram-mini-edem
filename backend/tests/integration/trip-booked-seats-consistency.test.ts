import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";

/**
 * Согласованность «карты мест» между двумя эндпоинтами одной поездки:
 * `GET /trips/:id` (bookedSeats) и `GET /trips` (bookedSeats), а также с
 * `seatsAvailable`.
 *
 * Единственный источник истины для занятости места — строка брони со
 * статусом pending/confirmed: `seatsAvailable` поддерживается парными
 * событиями и всегда равен `seatsTotal − <таких строк>`. Поэтому `bookedSeats`
 * в обоих ответах должен считаться по СТАТУСУ. Просроченный, но ещё не
 * выметенный pending продолжает удерживать место (до release/свипа), и его
 * исключение (expiry-aware) ломало согласованность: деталь говорила «3 места
 * свободны» на карте, а `seatsAvailable` — «2».
 *
 * Паттерн репо: реальная БД, прямые фикстуры, явная уборка.
 */
describe("bookedSeats — согласованность детали и списка", () => {
  let driverId: string;
  let passengerId: string;
  let tripId: string;
  const createdUserIds: string[] = [];
  let tgSeq = 8_600_000n;

  beforeEach(async () => {
    const driver = await db.user.create({
      data: { name: `SeatsDetailDriver ${Date.now()}`, telegramUserId: ++tgSeq, avatar: "" },
    });
    driverId = driver.id;
    createdUserIds.push(driver.id);

    const passenger = await db.user.create({
      data: { name: `SeatsDetailPax ${Date.now()}`, telegramUserId: ++tgSeq, avatar: "" },
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

    // Просроченный pending на месте 1: место удержано в учёте (декремент
    // не откатан), логически уже мертво.
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

  it("GET /trips/:id: bookedSeats содержит удержанное просроченное место и согласован с seatsAvailable", async () => {
    const res = await app.request(`/api/v1/trips/${tripId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seatsTotal: number;
      seatsAvailable: number;
      bookedSeats: number[];
    };
    expect(body.bookedSeats).toContain(1);
    expect(body.seatsAvailable + body.bookedSeats.length).toBe(body.seatsTotal);
  });

  it("GET /trips/:id и GET /trips дают одинаковые bookedSeats для одной поездки", async () => {
    const detailRes = await app.request(`/api/v1/trips/${tripId}`);
    const detail = (await detailRes.json()) as { bookedSeats: number[] };

    const listRes = await app.request("/api/v1/trips?limit=50");
    const list = (await listRes.json()) as {
      items: Array<{ id: string; bookedSeats: number[] }>;
    };
    const listed = list.items.find((t) => t.id === tripId);
    expect(listed).toBeDefined();

    expect([...detail.bookedSeats].sort()).toEqual([...listed!.bookedSeats].sort());
  });
});
