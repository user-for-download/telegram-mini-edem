import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { devMockAccessToken, registerDevTelegramUser } from "./dev-mock-auth.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

async function cleanDb() {
  await db.review.deleteMany();
  await db.booking.deleteMany();
  await db.trip.deleteMany();
  await db.car.deleteMany();
  await db.user.deleteMany();
}

beforeAll(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await db.$disconnect();
});

describe("health", () => {
  it("returns ok", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };

    expect(body.status).toBe("ok");
  });
});

/** Dev-initData формата dev-bypass (hash=dev-hash, ALLOW_DEV_AUTH под vitest). */
function devInitData(tgId: number, firstName = "Smoke"): string {
  registerDevTelegramUser(tgId);
  return new URLSearchParams([
    ["user", JSON.stringify({ id: tgId, first_name: firstName })],
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["hash", "dev-hash"],
  ]).toString();
}

describe("auth bootstrap", () => {
  it("creates user and returns token", async () => {
    await cleanDb();

    const response = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        initData: devInitData(111111, "Смоук"),
      }),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; name: string };
    };

    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.id).toBeTruthy();
    expect(body.user.name).toBeTruthy();
  });

  it("creates one user for concurrent Telegram launches", async () => {
    await cleanDb();

    const requests = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.request("/api/v1/auth/telegram", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            initData: devInitData(111113),
          }),
        })
      )
    );

    // Диагностика флейков: без реальных статусов/тел 429/500/401 выглядят
    // одинаково («expected false to be true»), поэтому печатаем сами.
    const results = await Promise.all(
      requests.map(async (response) => ({
        status: response.status,
        body: await response.text(),
      }))
    );

    if (results.some((result) => result.status !== 200)) {
      console.error("non-200 on concurrent Telegram launches:", results);
    }

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const users = await db.user.findMany({ where: { telegramUserId: 111113n } });
    expect(users).toHaveLength(1);
  });
});

describe("trips", () => {
  it("returns only active trips", async () => {
    await cleanDb();

    const driver = await db.user.create({
      data: {
        telegramUserId: 222222n,
        name: "Driver",
        avatar: "https://i.pravatar.cc/200?img=1",
      },
    });

    await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt: new Date("2030-01-01T09:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: ["Есть багаж"],
      },
    });

    await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: "Москва",
        fromAddress: "м. ВДНХ",
        toCity: "Ярославль",
        toAddress: "Автовокзал",
        departureAt: new Date("2030-01-01T10:00:00Z"),
        durationMinutes: 180,
        distanceKm: 265,
        price: 800,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
        status: "cancelled",
      },
    });

    const response = await app.request("/api/v1/trips", {
      headers: {
        Authorization: `Bearer ${devMockAccessToken(driver.id)}`,
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      items: Array<{
        fromCity: string;
        toCity: string;
        status: string;
      }>;
    };

    expect(body.items.length).toBe(1);
    expect(body.items[0].fromCity).toBe("Москва");
    expect(body.items[0].toCity).toBe("Тула");
    expect(body.items[0].status).toBe("active");
  });
});

describe("bookings smoke", () => {
  it("creates booking and decreases seatsAvailable", async () => {
    await cleanDb();

    const passenger = await db.user.create({
      data: {
        telegramUserId: 333333n,
        name: "Passenger",
        avatar: "https://i.pravatar.cc/200?img=2",
      },
    });

    const driver = await db.user.create({
      data: {
        telegramUserId: 444444n,
        name: "Driver",
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });

    const trip = await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt: new Date("2030-01-01T09:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
      },
    });

    const response = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(passenger.id)}`,
      },
      body: JSON.stringify({
        tripId: trip.id,
        seat: 1,
        comment: "Буду вовремя",
      }),
    });

    expect(response.status).toBe(201);

    const booking = (await response.json()) as { id: string; seat: number };

    expect(booking.id).toBeTruthy();
    expect(booking.seat).toBe(1);

    const updatedTrip = await db.trip.findUnique({
      where: { id: trip.id },
    });

    expect(updatedTrip?.seatsAvailable).toBe(1);
  });

  it("does not double-free a seat on concurrent cancels (Serializable)", async () => {
    await cleanDb();

    const passenger = await db.user.create({
      data: {
        telegramUserId: 555555n,
        name: "Passenger",
        avatar: "https://i.pravatar.cc/200?img=4",
      },
    });

    const driver = await db.user.create({
      data: {
        telegramUserId: 666666n,
        name: "Driver",
        avatar: "https://i.pravatar.cc/200?img=5",
      },
    });

    const trip = await db.trip.create({
      data: {
        driverId: driver.id,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt: new Date("2030-01-01T09:00:00Z"),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 2,
        tags: [],
      },
    });

    const booking = await db.booking.create({
      data: {
        tripId: trip.id,
        passengerId: passenger.id,
        seat: 1,
        status: "confirmed",
        comment: "",
      },
    });

    const cancel = () =>
      app.request(`/api/v1/bookings/${booking.id}/cancel`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${devMockAccessToken(passenger.id)}`,
        },
      });

    // Два параллельных запроса на отмену одной брони.
    const [r1, r2] = await Promise.all([cancel(), cancel()]);

    // Один запрос должен пройти, второй — получить 409/400 (уже отменена).
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(statuses[1]).toBeLessThan(500);

    // Место освободилось ровно один раз: 2 → 3, но не 4.
    const updatedTrip = await db.trip.findUnique({
      where: { id: trip.id },
    });
    expect(updatedTrip?.seatsAvailable).toBe(3);

    const cancelledCount = await db.booking.count({
      where: { id: booking.id, status: "cancelled" },
    });
    expect(cancelledCount).toBe(1);
  });
});
