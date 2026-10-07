import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Слой 1a: водитель поездки читает спрос (`GET /trips/:id/requests`) —
 * зеркало `GET /ride-requests/matching`, но ключом служит сама поездка.
 *
 * Подбор общий с уведомлениями при создании поездки
 * (`rideRequests/matching.ts`), поэтому кейсы ниже — ровно те предикаты,
 * которые проверяет этот предикат: маршрут, окно, статус/срок и
 * «заявка не от самого водителя».
 *
 * Паттерны репо (см. ride-requests.test.ts, trips-lifecycle.test.ts):
 * app.request() вместо supertest, dev mock-токены, уникальные telegramUserId
 * и города, уборка в обратном порядке зависимостей (заявки → поездки →
 * юзеры → города).
 */

// Окно поездки — через неделю от «сейчас» + 60 мин → tripEnd = +1ч1м.
// Относительное время во всём файле: абсолютная дата поездки в 2030 году
// требовала бы farFuture за пределами неё, и любая правка одной константы
// тихо ломала соседние тесты (окно заявки перестаёт пересекать отправление).
const TRIP_DEPARTURE = new Date(Date.now() + 7 * 24 * 3_600_000);
const TRIP_DURATION_MINUTES = 60;

const HOUR = 3_600_000;

/**
 * Границы окон заявок — в часах от отправления поездки.
 *
 * Явные смещения вместо литеральных дат: «окно заканчивается ДО отправления»
 * обязано быть выражено через −2ч, иначе тест зависит от того, как далеко в
 * будущем оказался TRIP_DEPARTURE.
 */
const shift = (hours: number): Date =>
  new Date(TRIP_DEPARTURE.getTime() + hours * HOUR);

/** telegramUserId — BigInt: счётчик вместо Date.now() (выходит за 32 бита). */
let tgSeq = 5_100_000n;

async function createUser(name: string): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `${name}-${tgSeq}`,
      telegramUserId: ++tgSeq,
      avatar: "",
    },
  });
  return user.id;
}

async function createCity(name: string): Promise<string> {
  const city = await db.city.create({
    data: {
      name,
      nameNormalized: name.trim().toLowerCase(),
    },
  });
  return city.id;
}

/** Заявка с явным окном и сроком — преддикат подбора проверяет все три. */
async function createRequest(params: {
  userId: string;
  fromCityId: string;
  toCityId: string;
  earliestAt: Date;
  latestAt: Date;
  expiresAt: Date;
  status?: string;
}): Promise<string> {
  const request = await db.rideRequest.create({
    data: {
      userId: params.userId,
      fromCityId: params.fromCityId,
      toCityId: params.toCityId,
      earliestAt: params.earliestAt,
      latestAt: params.latestAt,
      expiresAt: params.expiresAt,
      status: params.status ?? "active",
    },
  });
  return request.id;
}

describe("trip demand: GET /trips/:id/requests", () => {
  let driverId: string;
  let passengerId: string;
  let strangerId: string;
  let fromCityId: string;
  let toCityId: string;
  let otherToCityId: string;
  let tripId: string;

  // Даты относительные: абсолютный «2029» перестанет быть прошлым, как
  // только системные часы уедут вперёд, и «просроченная» заявка начнёт
  // попадать в подбор — тест проверял бы обратное, чем задумано.
  const farFuture = new Date(Date.now() + 365 * 24 * 3_600_000);
  const past = new Date(Date.now() - 60_000);

  beforeEach(async () => {
    driverId = await createUser("Demand driver");
    passengerId = await createUser("Demand passenger");
    strangerId = await createUser("Demand stranger");

    fromCityId = await createCity(`Demand from ${tgSeq}`);
    toCityId = await createCity(`Demand to ${tgSeq}`);
    otherToCityId = await createCity(`Demand other ${tgSeq}`);

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: `Demand from ${tgSeq}`,
        fromAddress: "ул. Отправления, 1",
        toCity: `Demand to ${tgSeq}`,
        toAddress: "ул. Назначения, 2",
        fromCityId,
        toCityId,
        departureAt: TRIP_DEPARTURE,
        durationMinutes: TRIP_DURATION_MINUTES,
        distanceKm: 120,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
  });

  afterEach(async () => {
    const userIds = [driverId, passengerId, strangerId];
    // Порядок обязателен: заявки и поездки ссылаются и на юзеров, и на города.
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({
      where: { id: { in: [fromCityId, toCityId, otherToCityId] } },
    });
  });

  function auth(user: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(user)}` };
  }

  /** Элементы ответа `{items}` с типами: без `any` в тесте тоже. */
  async function readItems(response: Response): Promise<
    Array<{
      id: string;
      seats: number;
      status: string;
      fromCity: { id: string; name: string };
      toCity: { id: string; name: string };
    }>
  > {
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("items" in body) ||
      !Array.isArray(body.items)
    ) {
      throw new Error("Unexpected response shape: items missing");
    }
    return body.items as Array<{
      id: string;
      seats: number;
      status: string;
      fromCity: { id: string; name: string };
      toCity: { id: string; name: string };
    }>;
  }

  it("returns matching requests to the driver and hides the rest", async () => {
    // Arrange
    const matchingId = await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
      expiresAt: farFuture,
    });
    // Другой маршрут при подходящем окне.
    await createRequest({
      userId: strangerId,
      fromCityId,
      toCityId: otherToCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
      expiresAt: farFuture,
    });
    // Тот же маршрут, но окно заявки заканчивается ДО отправления поездки.
    await createRequest({
      userId: strangerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-4),
      latestAt: shift(-2),
      expiresAt: farFuture,
    });
    // Окно пересекается, но заявка просрочена.
    await createRequest({
      userId: strangerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
      expiresAt: past,
    });
    // Окно пересекается, но заявка не активна.
    await createRequest({
      userId: strangerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
      expiresAt: farFuture,
      status: "paused",
    });

    // Act
    const response = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(driverId),
    });

    // Assert
    expect(response.status).toBe(200);
    const items = await readItems(response);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: matchingId,
      fromCity: { id: fromCityId },
      toCity: { id: toCityId },
      status: "active",
      seats: 1,
    });
    // Автор заявки наружу не отдаётся (privacy, как в ленте спроса).
    expect(JSON.stringify(items)).not.toContain(passengerId);
  });

  it("excludes the driver's own request", async () => {
    // Arrange: водитель — тоже пассажир своего маршрута.
    const ownRequestId = await createRequest({
      userId: driverId,
      fromCityId,
      toCityId,
      earliestAt: TRIP_DEPARTURE,
      latestAt: farFuture,
      expiresAt: farFuture,
    });
    await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: TRIP_DEPARTURE,
      latestAt: farFuture,
      expiresAt: farFuture,
    });

    // Act
    const response = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(driverId),
    });

    // Assert: в ответе только чужая заявка.
    expect(response.status).toBe(200);
    const items = await readItems(response);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain(ownRequestId);
  });

  it("forbids a non-driver (403)", async () => {
    // Arrange
    await createRequest({
      userId: strangerId,
      fromCityId,
      toCityId,
      earliestAt: TRIP_DEPARTURE,
      latestAt: farFuture,
      expiresAt: farFuture,
    });

    // Act
    const response = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(strangerId),
    });

    // Assert
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("returns 404 for an unknown trip", async () => {
    // Arrange / Act
    const response = await app.request(
      `/api/v1/trips/${randomUUID()}/requests`,
      { headers: auth(driverId) },
    );

    // Assert
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
  });

  it("returns an empty list when nothing matches", async () => {
    // Arrange / Act
    const response = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(driverId),
    });

    // Assert
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([]);
  });
});
