import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Защита от перекрывающихся поездок (водитель) и броней (пассажир):
 * интервал поездки = [departureAt, departureAt + durationMinutes].
 *
 * Паттерны репо: app.request(), dev-авторизация mock-токеном
 * (tests/dev-mock-auth.js: allowlist + TTL).
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Получить id города из справочника, создав при отсутствии. Нужен
 * тестам, которые создают поездки через API (DTO требует
 * fromCityId/toCityId — справочник обязателен).
 */
async function ensureCity(name: string): Promise<string> {
  const nameNormalized = name.trim().toLowerCase();
  const existing = await db.city.findFirst({ where: { nameNormalized } });
  if (existing) return existing.id;
  const created = await db.city.create({ data: { name, nameNormalized } });
  return created.id;
}

describe("Overlap protection", () => {
  let tgSeq = 4_200_000n;
  let driverId: string;
  let driver2Id: string;
  let passengerId: string;
  const createdTripIds: string[] = [];

  async function createUser(name: string): Promise<string> {
    for (;;) {
      try {
        const user = await db.user.create({
          data: {
            name: `${name}-${Date.now()}`,
            telegramUserId: ++tgSeq,
            avatar: "https://i.pravatar.cc/200?img=9",
          },
        });
        return user.id;
      } catch (error) {
        // Остатки от прошлого упавшего прогона: пробуем следующий telegramUserId.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async function createTrip(
    departureAt: string,
    durationMinutes: number,
    authId: string = driverId
  ): Promise<{ status: number; body: unknown }> {
    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(authId)}`,
      },
      body: JSON.stringify({
        fromCity: "Москва",
        fromAddress: "Тверская 1",
        toCity: "СПб",
        toAddress: "Невский 1",
        fromCityId: await ensureCity("Москва"),
        toCityId: await ensureCity("СПб"),
        departureAt,
        durationMinutes,
        distanceKm: 700,
        price: 2000,
        seatsTotal: 3,
        tags: [],
      }),
    });
    return { status: res.status, body: await res.json() };
  }

  async function updateTripDeparture(
    tripId: string,
    departureAt: string
  ): Promise<{ status: number; body: unknown }> {
    const res = await app.request(`/api/v1/trips/${tripId}`, {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify({ departureAt }),
    });
    return { status: res.status, body: await res.json() };
  }

  async function book(
    tripId: string,
    authId: string = passengerId
  ): Promise<{ status: number; body: unknown }> {
    const res = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(authId)}`,
      },
      body: JSON.stringify({ tripId, seat: 1 }),
    });
    return { status: res.status, body: await res.json() };
  }

  beforeEach(async () => {
    driverId = await createUser("OverlapDriver");
    driver2Id = await createUser("OverlapDriver2");
    passengerId = await createUser("OverlapPassenger");

    // Водителям нужен автомобиль для создания поездки.
    await db.car.create({
      data: {
        userId: driverId,
        model: "Tesla",
        color: "red",
        plate: `OV${tgSeq}`,
      },
    });
    await db.car.create({
      data: {
        userId: driver2Id,
        model: "Tesla",
        color: "blue",
        plate: `OV${tgSeq + 1n}`,
      },
    });
  });

  afterEach(async () => {
    await db.booking.deleteMany({
      where: { tripId: { in: createdTripIds } },
    });
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    await db.car.deleteMany({
      where: { userId: { in: [driverId, driver2Id] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [driverId, driver2Id, passengerId] } },
    });
    createdTripIds.length = 0;
  });

  it("водитель не может создать поездку, пересекающуюся с его активной", async () => {
    const first = await createTrip("2030-07-01T10:00:00Z", 120);
    expect(first.status).toBe(201);
    createdTripIds.push(first.body.id);

    const overlapping = await createTrip("2030-07-01T11:00:00Z", 120);
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.code).toBe("DRIVER_TRIP_OVERLAP");
  });

  it("точная граница (12:00/12:00) не считается пересечением", async () => {
    const first = await createTrip("2030-07-01T10:00:00Z", 120);
    expect(first.status).toBe(201);
    createdTripIds.push(first.body.id);

    const boundary = await createTrip("2030-07-01T12:00:00Z", 120);
    expect(boundary.status).toBe(201);
    createdTripIds.push(boundary.body.id);
  });

  it("водитель не может перенести поездку на пересекающееся время", async () => {
    const first = await createTrip("2030-07-01T10:00:00Z", 120);
    expect(first.status).toBe(201);
    createdTripIds.push(first.body.id);

    const second = await createTrip("2030-07-01T14:00:00Z", 120);
    expect(second.status).toBe(201);
    createdTripIds.push(second.body.id);

    const moved = await updateTripDeparture(second.body.id, "2030-07-01T11:00:00Z");
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("DRIVER_TRIP_OVERLAP");
  });

  it("пассажир не может забронировать пересекающуюся по времени поездку", async () => {
    const tripA = await createTrip("2030-07-01T10:00:00Z", 120);
    // Вторую поездку создаёт ДРУГОЙ водитель: иначе вторая поездка
    // сама упрётся в защиту от пересечения поездок водителя.
    const tripB = await createTrip("2030-07-01T11:00:00Z", 120, driver2Id);
    expect(tripA.status).toBe(201);
    expect(tripB.status).toBe(201);
    createdTripIds.push(tripA.body.id, tripB.body.id);

    const firstBooking = await book(tripA.body.id);
    expect(firstBooking.status).toBe(201);

    const overlappingBooking = await book(tripB.body.id);
    expect(overlappingBooking.status).toBe(409);
    expect(overlappingBooking.body.code).toBe("PASSENGER_BOOKING_OVERLAP");
  });

  it("неактивные (cancelled) брони не блокируют пересечение по времени", async () => {
    const tripA = await createTrip("2030-07-01T10:00:00Z", 120);
    const tripB = await createTrip("2030-07-01T11:00:00Z", 120, driver2Id);
    expect(tripA.status).toBe(201);
    expect(tripB.status).toBe(201);
    createdTripIds.push(tripA.body.id, tripB.body.id);

    // Отменённая бронь на поездку A — не должна мешать брони B.
    await db.booking.create({
      data: {
        tripId: tripA.body.id,
        passengerId,
        seat: 1,
        status: "cancelled",
      },
    });

    const booking = await book(tripB.body.id);
    expect(booking.status).toBe(201);
  });
});
