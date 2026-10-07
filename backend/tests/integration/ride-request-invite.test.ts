import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRIVER_INVITE_NOTIFICATION_TYPE } from "@edem/contracts";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Слой 1b: водитель поездки зовёт конкретного пассажира
 * (`POST /ride-requests/:id/invite`), пассажир получает одно уведомление
 * `driver_invite` с deep-link на карточку поездки и бронирует САМ.
 *
 * Что здесь зафиксировано (каждое «не» — тоже контракт):
 * - приглашение создаёт ровно ОДНО уведомление и НЕ создаёт бронь;
 * - поездка без свободных мест — 409 и НОЛЬ уведомлений (тупик не отправляем);
 * - приглашать может только водитель этой поездки;
 * - повтор той же пары (заявка + поездка) не плодит дубль;
 * - позвать можно только заявку, подходящую под поездку, — иначе 404.
 *
 * Паттерны репо (см. trip-ride-requests.test.ts, ride-requests.test.ts):
 * app.request() вместо supertest, dev mock-токены, уникальные telegramUserId
 * и города, относительные даты от общей базы, уборка в обратном порядке
 * зависимостей (уведомления → заявки → поездки → юзеры → города).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const HOUR = 3_600_000;

// Отправление поездки — через неделю от «сейчас», рейс 60 минут, значит
// tripEnd = отправление + 1ч. Относительное время во всём файле: абсолютный
// год уехал бы в прошлое вместе с системными часами, и «несовпадающее» окно
// заявки в последнем тесте молча стало бы подходящим.
const TRIP_DEPARTURE = new Date(Date.now() + 7 * 24 * HOUR);
const TRIP_DURATION_MINUTES = 60;

/** Границы окон заявок — в часах ОТ отправления поездки. */
const shift = (hours: number): Date =>
  new Date(TRIP_DEPARTURE.getTime() + hours * HOUR);

/** Срок заявки — заведомо после отправления, иначе она выпадет из подбора. */
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * HOUR);

/** telegramUserId — BigInt: счётчик, а не Date.now() (вышел бы за 32 бита). */
let tgSeq = 6_700_000n;

/** Юзер с уникальным именем; имя нужно для `actorName` уведомления. */
async function createUser(
  name: string,
): Promise<{ id: string; name: string }> {
  const unique = `${name}-${++tgSeq}`;
  const user = await db.user.create({
    data: { name: unique, telegramUserId: tgSeq, avatar: "" },
  });
  return { id: user.id, name: unique };
}

async function createCity(name: string): Promise<string> {
  const city = await db.city.create({
    data: { name, nameNormalized: name.trim().toLowerCase() },
  });
  return city.id;
}

describe("driver invite: POST /ride-requests/:id/invite", () => {
  let driverId: string;
  let driverName: string;
  let passengerId: string;
  let strangerId: string;
  let fromCityId: string;
  let toCityId: string;
  let tripFrom: string;
  let tripTo: string;
  let tripId: string;

  beforeEach(async () => {
    const driver = await createUser("Invite driver");
    driverId = driver.id;
    driverName = driver.name;
    passengerId = (await createUser("Invite passenger")).id;
    strangerId = (await createUser("Invite stranger")).id;

    fromCityId = await createCity(`Invite from ${tgSeq}`);
    toCityId = await createCity(`Invite to ${tgSeq}`);

    // Снимок городов в поездке — то, что попадает в строки уведомления.
    tripFrom = `Invite from ${tgSeq}`;
    tripTo = `Invite to ${tgSeq}`;
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: tripFrom,
        fromAddress: "ул. Отправления, 1",
        toCity: tripTo,
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
    // Порядок обязателен: уведомления и заявки ссылаются на юзеров, поездки —
    // на юзеров и города, города — на заявки (Restrict).
    // Брони удаляются каскадом вместе с поездкой.
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({ where: { id: { in: [fromCityId, toCityId] } } });
  });

  function auth(user: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(user)}` };
  }

  /** Заявка с явным окном и сроком — предикат подбора проверяет все три. */
  async function createRequest(params: {
    userId: string;
    fromCityId: string;
    toCityId: string;
    earliestAt: Date;
    latestAt: Date;
  }): Promise<string> {
    const request = await db.rideRequest.create({
      data: {
        userId: params.userId,
        fromCityId: params.fromCityId,
        toCityId: params.toCityId,
        earliestAt: params.earliestAt,
        latestAt: params.latestAt,
        expiresAt: FAR_FUTURE,
        status: "active",
      },
    });
    return request.id;
  }

  /** Заявка, подходящая под поездку: тот же маршрут, окно шире рейса. */
  async function createMatchingRequest(): Promise<string> {
    return createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
    });
  }

  function invite(
    requestId: string,
    as: string,
    targetTripId: string = tripId,
  ): Promise<Response> {
    return app.request(`/api/v1/ride-requests/${requestId}/invite`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(as) },
      body: JSON.stringify({ tripId: targetTripId }),
    });
  }

  /** Приглашения конкретного получателя — их тут ноль или одна. */
  function invitesOf(userId: string) {
    return db.notification.findMany({
      where: { userId, type: DRIVER_INVITE_NOTIFICATION_TYPE },
      orderBy: { createdAt: "asc" },
    });
  }

  it("notifies the requester once with a /trips/<uuid> deep link and books nothing", async () => {
    // Arrange
    const requestId = await createMatchingRequest();

    // Act
    const response = await invite(requestId, driverId);

    // Assert: ровно одно уведомление с deep-link на карточку поездки.
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ invited: true, duplicate: false });

    const created = await invitesOf(passengerId);
    expect(created).toHaveLength(1);
    const [notification] = created;
    expect(notification.id).toBe(
      (body as { notificationId: string }).notificationId,
    );
    expect(notification.type).toBe(DRIVER_INVITE_NOTIFICATION_TYPE);
    // Deep-link — только allowlist-маршрут: без query, hash и сырых данных.
    expect(notification.deepLink).toBe(`/trips/${tripId}`);
    // Контекст поездки обязателен для строки ячейки (driverInviteNotificationSchema).
    expect(notification.tripFrom).toBe(tripFrom);
    expect(notification.tripTo).toBe(tripTo);
    expect(notification.tripDepartureAt).toEqual(TRIP_DEPARTURE);
    expect(notification.actorName).toBe(driverName);
    expect(notification.recipientRole).toBe("passenger");
    expect(notification.action).toBe("invited");

    // Бронь создаёт пассажир сам: ни брони, ни смены статуса заявки.
    expect(await db.booking.count({ where: { tripId } })).toBe(0);
    const request = await db.rideRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    expect(request?.status).toBe("active");
  });

  it("returns 409 and creates no notification when the trip has no free seats", async () => {
    // Arrange: места кончились — приглашать некого.
    const requestId = await createMatchingRequest();
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: 0 },
    });

    // Act
    const response = await invite(requestId, driverId);

    // Assert: отказ и НОЛЬ уведомлений — тупик пассажиру не показываем.
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CONFLICT");
    expect(await invitesOf(passengerId)).toHaveLength(0);
  });

  it("forbids a non-driver (403) and creates no notification", async () => {
    // Arrange: поездка чужая, заявка под неё подходит.
    const requestId = await createMatchingRequest();

    // Act
    const response = await invite(requestId, strangerId);

    // Assert
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
    expect(await invitesOf(passengerId)).toHaveLength(0);
  });

  it("does not create a duplicate when the driver invites the same request twice", async () => {
    // Arrange
    const requestId = await createMatchingRequest();

    // Act
    const first = await invite(requestId, driverId);
    const second = await invite(requestId, driverId);

    // Assert: повтор идемпотентен — тот же id, никакой второй записи.
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const [firstBody, secondBody] = await Promise.all([
      first.json(),
      second.json(),
    ]);
    expect(secondBody).toMatchObject({
      invited: true,
      duplicate: true,
      notificationId: firstBody.notificationId,
    });
    expect(await invitesOf(passengerId)).toHaveLength(1);
  });

  it("rejects a request that does not match the trip and creates no notification", async () => {
    // Arrange: тот же маршрут, но окно заявки заканчивается ДО отправления —
    // ровно тот предикат, который отсекает `matchingRideRequestWhere`.
    const requestId = await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-4),
      latestAt: shift(-2),
    });

    // Act
    const response = await invite(requestId, driverId);

    // Assert: 404, а не «409 заявка не подходит» — иначе по чужому id можно
    // было бы узнать, что такая заявка существует.
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
    expect(await invitesOf(passengerId)).toHaveLength(0);
  });
});
