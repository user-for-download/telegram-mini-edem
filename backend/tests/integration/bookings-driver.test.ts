import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * GET /bookings/driver — сводка pending-заявок водителя по всем его
 * активным будущим поездкам (главная страница мини-аппа).
 *
 * Паттерны репо (см. bookings-pagination.test.ts): app.request() вместо
 * supertest, dev-авторизация mock-токеном, уникальные telegramUserId.
 */
describe("GET /bookings/driver", () => {
  const cleanupIds: { users: string[]; trips: string[] } = {
    users: [],
    trips: [],
  };
  let tgSeq = 1_700_000n;

  async function createUser(name: string) {
    const user = await db.user.create({
      data: {
        name,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });
    cleanupIds.users.push(user.id);
    return user;
  }

  async function createTrip(
    driverId: string,
    departureAt: Date,
    status: "active" | "completed" = "active",
  ) {
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Вологда",
        fromAddress: "Центр",
        toCity: "Череповец",
        toAddress: "Вокзал",
        departureAt,
        durationMinutes: 120,
        distanceKm: 120,
        price: 450,
        seatsTotal: 3,
        seatsAvailable: 3,
        status,
        tags: [],
      },
    });
    cleanupIds.trips.push(trip.id);
    return trip;
  }

  async function createPendingBooking(
    tripId: string,
    passengerId: string,
    seat = 1,
  ) {
    return db.booking.create({
      data: {
        tripId,
        passengerId,
        seat,
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  afterEach(async () => {
    await db.booking.deleteMany({
      where: { tripId: { in: cleanupIds.trips } },
    });
    await db.trip.deleteMany({ where: { id: { in: cleanupIds.trips } } });
    await db.user.deleteMany({ where: { id: { in: cleanupIds.users } } });
    cleanupIds.users = [];
    cleanupIds.trips = [];
  });

  it("возвращает pending-заявки всех активных будущих поездок водителя", async () => {
    const driver = await createUser(`Driver-${Date.now()}`);
    const passengerA = await createUser(`Passenger-A-${Date.now()}`);
    const passengerB = await createUser(`Passenger-B-${Date.now()}`);

    const nearTrip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );
    const farTrip = await createTrip(
      driver.id,
      new Date(Date.now() + 2 * 86_400_000),
    );

    await createPendingBooking(farTrip.id, passengerA.id, 1);
    await createPendingBooking(nearTrip.id, passengerB.id, 2);

    const response = await app.request("/api/v1/bookings/driver", {
      headers: { authorization: `Bearer ${devMockAccessToken(driver.id)}` },
    });

    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<{
      id: string;
      status: string;
      trip: { id: string; departureAt: string };
      passenger: { id: string; rating: number; avatar: string };
    }>;

    // Обе заявки по обеим поездкам, сортировка по времени отправления.
    expect(items).toHaveLength(2);
    expect(items[0].trip.id).toBe(nearTrip.id);
    expect(items[1].trip.id).toBe(farTrip.id);
    expect(items.every((item) => item.status === "pending")).toBe(true);
    // Пассажир с аватаром и рейтингом вложен (досье в модалке).
    expect(items[0].passenger.id).toBe(passengerB.id);
    expect(typeof items[0].passenger.rating).toBe("number");
    expect(items[0].passenger.avatar).toContain("https://");
  });

  it("скрывает прошедшие поездки и чужие заявки", async () => {
    const driver = await createUser(`Driver-${Date.now()}`);
    const otherDriver = await createUser(`Other-${Date.now()}`);
    const passenger = await createUser(`Passenger-${Date.now()}`);

    const pastTrip = await createTrip(
      driver.id,
      new Date(Date.now() - 86_400_000),
    );
    const otherTrip = await createTrip(
      otherDriver.id,
      new Date(Date.now() + 86_400_000),
    );

    await createPendingBooking(pastTrip.id, passenger.id, 1);
    await createPendingBooking(otherTrip.id, passenger.id, 1);

    const response = await app.request("/api/v1/bookings/driver", {
      headers: { authorization: `Bearer ${devMockAccessToken(driver.id)}` },
    });

    expect(response.status).toBe(200);
    const items = (await response.json()) as unknown[];
    // Прошедшая поездка водителя и чужая поездка не попадают в сводку.
    expect(items).toHaveLength(0);
  });

  it("требует авторизацию", async () => {
    const response = await app.request("/api/v1/bookings/driver");
    expect(response.status).toBe(401);
  });
});
