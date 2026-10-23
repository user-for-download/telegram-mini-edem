import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Регрессия поиска GET /trips: уехавшие поездки скрываются.
 *
 * Автозавершение воркером происходит только через 24 часа после отправления,
 * поэтому между отправлением и автозавершением поездка всё ещё active —
 * до исправления поиск показывал рейсы, на которые уже невозможно успеть.
 * Теперь фильтр всегда включает departureAt > now.
 *
 * Паттерны репо (см. smoke.test.ts, trip-address-visibility.test.ts):
 * app.request() вместо supertest, уникальные telegramUserId (INT4-счётчик),
 * поиск по своим поездкам через уникальный fromCity (БД общая на файл).
 */
const SEARCH_CITY = "Тестовск";

const createdUserIds: string[] = [];
const createdTripIds: string[] = [];
// telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
let tgSeq = 9_300_000n;

async function createDriver(): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `DepartedDriver-${tgSeq + 1n}`,
      telegramUserId: ++tgSeq,
      avatar: "https://i.pravatar.cc/200?img=6",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function createTrip(driverId: string, departureAt: Date): Promise<string> {
  const trip = await db.trip.create({
    data: {
      driverId,
      fromCity: SEARCH_CITY,
      fromAddress: "Автостанция",
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
  createdTripIds.push(trip.id);
  return trip.id;
}

afterEach(async () => {
  if (createdTripIds.length > 0) {
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    createdTripIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("GET /trips — departed trips hidden", () => {
  it("returns a future trip in search results", async () => {
    // Arrange
    const driverId = await createDriver();
    const futureTripId = await createTrip(
      driverId,
      new Date("2030-01-01T09:00:00Z")
    );

    // Act
    const res = await app.request(
      `/api/v1/trips?fromCity=${encodeURIComponent(SEARCH_CITY)}`,
      {
        headers: {
          Authorization: `Bearer ${devMockAccessToken(driverId)}`,
        },
      },
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    const listed = body.items.find((t) => t.id === futureTripId);
    expect(listed).toBeDefined();
  });

  it("hides trips with departureAt in the past", async () => {
    // Arrange: одна поездка уже уехала (час назад), вторая — в будущем.
    const driverId = await createDriver();
    const departedTripId = await createTrip(
      driverId,
      new Date(Date.now() - 3_600_000)
    );
    const futureTripId = await createTrip(
      driverId,
      new Date("2030-01-01T09:00:00Z")
    );

    // Act
    const res = await app.request(
      `/api/v1/trips?fromCity=${encodeURIComponent(SEARCH_CITY)}`,
      {
        headers: {
          Authorization: `Bearer ${devMockAccessToken(driverId)}`,
        },
      },
    );

    // Assert — уехавшая скрыта, будущая на месте.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.find((t) => t.id === departedTripId)).toBeUndefined();
    expect(body.items.find((t) => t.id === futureTripId)).toBeDefined();

    // Поездка скрыта именно фильтром, а не изменением статуса.
    const dbTrip = await db.trip.findUnique({ where: { id: departedTripId } });
    expect(dbTrip?.status).toBe("active");
  });
});
