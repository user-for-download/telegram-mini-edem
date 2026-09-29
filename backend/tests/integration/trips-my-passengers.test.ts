import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * GET /trips/my — карточка водителя получает подтверждённых пассажиров
 * (id/name/avatar) для аватарстака вместо своего рейтинга.
 *
 * Проверяем также приватность: публичная лента /trips поле `passengers`
 * не отдаёт.
 */
describe("GET /trips/my passengers", () => {
  const cleanup = { users: [] as string[], trips: [] as string[] };
  let tgSeq = 1_800_000n;

  async function createUser(name: string, avatar: string) {
    const user = await db.user.create({
      data: { name, telegramUserId: ++tgSeq, avatar },
    });
    cleanup.users.push(user.id);
    return user;
  }

  async function createTrip(driverId: string) {
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Вологда",
        fromAddress: "Центр",
        toCity: "Череповец",
        toAddress: "Вокзал",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 120,
        distanceKm: 120,
        price: 450,
        seatsTotal: 3,
        seatsAvailable: 0,
        status: "active",
        tags: [],
      },
    });
    cleanup.trips.push(trip.id);
    return trip;
  }

  async function createBooking(
    tripId: string,
    passengerId: string,
    seat: number,
    status: "pending" | "confirmed",
  ) {
    return db.booking.create({
      data: {
        tripId,
        passengerId,
        seat,
        status,
        ...(status === "pending"
          ? { expiresAt: new Date(Date.now() + 86_400_000) }
          : {}),
      },
    });
  }

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId: { in: cleanup.trips } } });
    await db.trip.deleteMany({ where: { id: { in: cleanup.trips } } });
    await db.user.deleteMany({ where: { id: { in: cleanup.users } } });
    cleanup.users = [];
    cleanup.trips = [];
  });

  it("отдаёт подтверждённых пассажиров и не отдаёт pending", async () => {
    const driver = await createUser("Driver", "https://t.me/driver.png");
    const confirmedA = await createUser("Иван", "https://t.me/a.png");
    const confirmedB = await createUser("Пётр", "https://t.me/b.png");
    const pending = await createUser("Ожидающий", "https://t.me/c.png");

    const trip = await createTrip(driver.id);
    await createBooking(trip.id, confirmedB.id, 2, "confirmed");
    await createBooking(trip.id, confirmedA.id, 1, "confirmed");
    await createBooking(trip.id, pending.id, 3, "pending");

    const response = await app.request("/api/v1/trips/my?status=active", {
      headers: { authorization: `Bearer ${devMockAccessToken(driver.id)}` },
    });

    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: Array<{
        id: string;
        passengers?: Array<{ id: string; name: string; avatar: string }>;
      }>;
    };
    const card = items.find((item) => item.id === trip.id);
    expect(card?.passengers).toHaveLength(2);
    // Сортировка по месту: Иван (1) раньше Петра (2), pending не попал.
    expect(card?.passengers?.map((p) => p.name)).toEqual(["Иван", "Пётр"]);
    expect(card?.passengers?.[0].avatar).toBe("https://t.me/a.png");
  });

  it("публичные детали /trips/:id не раскрывают пассажиров", async () => {
    const driver = await createUser("Driver", "https://t.me/driver.png");
    const passenger = await createUser("Иван", "https://t.me/a.png");
    const trip = await createTrip(driver.id);
    await createBooking(trip.id, passenger.id, 1, "confirmed");

    const response = await app.request(`/api/v1/trips/${trip.id}`);
    expect(response.status).toBe(200);
    const card = (await response.json()) as { passengers?: unknown };
    expect(card.passengers).toBeUndefined();
  });
});
