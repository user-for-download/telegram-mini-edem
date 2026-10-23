import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { notifyMatchingRideRequests } from "../../src/rideRequests/matching.js";
import {
  JSON_HEADERS,
  authHeaders,
  cleanupTelegramFixtures,
  seedCity,
  seedTelegramUser,
  seedTrip,
  uniqueIp,
} from "../fixtures/telegram.js";

type TestUser = { id: string };

let first: TestUser;
let second: TestUser;
let firstTripId: string;
let secondTripId: string;
let fromCity: { id: string; name: string };
let toCity: { id: string; name: string };

const headersFor = (userId: string) => authHeaders(userId, uniqueIp());

async function block(blockerId: string, blockedId: string): Promise<Response> {
  return app.request(`/api/v1/blocks/${blockedId}`, {
    method: "PUT",
    headers: headersFor(blockerId),
  });
}

async function tripIdsVisibleTo(userId: string): Promise<string[]> {
  const response = await app.request("/api/v1/trips?limit=50", {
    headers: headersFor(userId),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Array<{ id: string }> };
  return body.items.map((trip) => trip.id);
}

beforeAll(async () => {
  first = await seedTelegramUser({ name: "Block First" });
  second = await seedTelegramUser({ name: "Block Second" });
  firstTripId = await seedTrip(first.id, {
    fromCity: "Блок-А",
    toCity: "Блок-Б",
    departureAt: new Date("2030-08-01T09:00:00.000Z"),
  });
  secondTripId = await seedTrip(second.id, {
    fromCity: "Блок-Б",
    toCity: "Блок-А",
    departureAt: new Date("2030-08-02T09:00:00.000Z"),
  });
  fromCity = await seedCity("BlockFrom");
  toCity = await seedCity("BlockTo");
});

beforeEach(async () => {
  await db.userBlock.deleteMany({
    where: {
      OR: [
        { blockerId: { in: [first.id, second.id] } },
        { blockedId: { in: [first.id, second.id] } },
      ],
    },
  });
  await db.booking.deleteMany({
    where: {
      tripId: { in: [firstTripId, secondTripId] },
      passengerId: { in: [first.id, second.id] },
    },
  });
  await db.trip.updateMany({
    where: { id: { in: [firstTripId, secondTripId] } },
    data: { seatsAvailable: 3, status: "active" },
  });
  await db.rideRequest.deleteMany({
    where: { userId: { in: [first.id, second.id] } },
  });
  await db.notification.deleteMany({
    where: { userId: { in: [first.id, second.id] } },
  });
});

afterAll(async () => {
  await cleanupTelegramFixtures();
});

describe("личный чёрный список API", () => {
  it("идемпотентно добавляет, показывает только владельцу и удаляет", async () => {
    expect((await block(first.id, second.id)).status).toBe(200);
    expect((await block(first.id, second.id)).status).toBe(200);
    expect(
      await db.userBlock.count({
        where: { blockerId: first.id, blockedId: second.id },
      }),
    ).toBe(1);

    const ownList = await app.request("/api/v1/blocks", {
      headers: headersFor(first.id),
    });
    const ownBody = (await ownList.json()) as {
      items: Array<{ user: { id: string } }>;
      pagination: { total: number };
    };
    expect(ownList.status).toBe(200);
    expect(ownBody.items.map((item) => item.user.id)).toContain(second.id);
    expect(ownBody.pagination.total).toBe(1);

    const incomingStatus = await app.request(`/api/v1/blocks/${first.id}`, {
      headers: headersFor(second.id),
    });
    expect(await incomingStatus.json()).toEqual({ blockedByMe: false });

    const removed = await app.request(`/api/v1/blocks/${second.id}`, {
      method: "DELETE",
      headers: headersFor(first.id),
    });
    expect(removed.status).toBe(200);
    expect(
      await db.userBlock.count({
        where: { blockerId: first.id, blockedId: second.id },
      }),
    ).toBe(0);
  });

  it("отклоняет self-block и отсутствующего пользователя", async () => {
    const self = await block(first.id, first.id);
    expect(self.status).toBe(400);

    const missing = await block(first.id, "missing-user-id");
    expect(missing.status).toBe(404);
  });
});

describe("взаимное скрытие и booking guard", () => {
  it("одна направленная запись скрывает новые поездки у обеих сторон", async () => {
    expect((await block(first.id, second.id)).status).toBe(200);

    expect(await tripIdsVisibleTo(first.id)).not.toContain(secondTripId);
    expect(await tripIdsVisibleTo(second.id)).not.toContain(firstTripId);

    const firstLooksAtSecond = await app.request(
      `/api/v1/trips/${secondTripId}`,
      { headers: headersFor(first.id) },
    );
    const secondLooksAtFirst = await app.request(
      `/api/v1/trips/${firstTripId}`,
      { headers: headersFor(second.id) },
    );
    expect(firstLooksAtSecond.status).toBe(404);
    expect(secondLooksAtFirst.status).toBe(404);
  });

  it("не позволяет создать бронь по прямому id и не списывает место", async () => {
    expect((await block(first.id, second.id)).status).toBe(200);
    const response = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headersFor(second.id) },
      body: JSON.stringify({ tripId: firstTripId, seat: 1 }),
    });
    expect(response.status).toBe(404);
    expect(
      await db.booking.count({
        where: { tripId: firstTripId, passengerId: second.id },
      }),
    ).toBe(0);
    expect(
      (await db.trip.findUniqueOrThrow({ where: { id: firstTripId } }))
        .seatsAvailable,
    ).toBe(3);

    // Статус скрытой поездки тоже не раскрываем: block guard стоит раньше
    // TRIP_NOT_ACTIVE/времени и сохраняет одинаковый 404.
    await db.trip.update({
      where: { id: firstTripId },
      data: { status: "cancelled" },
    });
    const cancelled = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headersFor(second.id) },
      body: JSON.stringify({ tripId: firstTripId, seat: 1 }),
    });
    expect(cancelled.status).toBe(404);
  });

  it("сохраняет живую бронь и её идемпотентный retry", async () => {
    const created = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headersFor(second.id) },
      body: JSON.stringify({ tripId: firstTripId, seat: 1 }),
    });
    expect(created.status).toBe(201);
    expect((await block(first.id, second.id)).status).toBe(200);

    const detail = await app.request(`/api/v1/trips/${firstTripId}`, {
      headers: headersFor(second.id),
    });
    expect(detail.status).toBe(200);
    expect(await tripIdsVisibleTo(second.id)).not.toContain(firstTripId);

    const retry = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headersFor(second.id) },
      body: JSON.stringify({ tripId: firstTripId, seat: 1 }),
    });
    expect(retry.status).toBe(200);
    expect(
      await db.booking.count({
        where: { tripId: firstTripId, passengerId: second.id },
      }),
    ).toBe(1);
  });

  it("встречная блокировка продолжает действовать после удаления своей", async () => {
    expect((await block(first.id, second.id)).status).toBe(200);
    expect((await block(second.id, first.id)).status).toBe(200);

    await app.request(`/api/v1/blocks/${second.id}`, {
      method: "DELETE",
      headers: headersFor(first.id),
    });
    expect(await tripIdsVisibleTo(first.id)).not.toContain(secondTripId);

    await app.request(`/api/v1/blocks/${first.id}`, {
      method: "DELETE",
      headers: headersFor(second.id),
    });
    expect(await tripIdsVisibleTo(first.id)).toContain(secondTripId);
  });
});

describe("ride-request matching", () => {
  it("не показывает спрос и не создаёт match-уведомление для закрытой пары", async () => {
    await db.rideRequest.create({
      data: {
        userId: second.id,
        fromCityId: fromCity.id,
        toCityId: toCity.id,
        earliestAt: new Date("2030-09-01T08:00:00.000Z"),
        latestAt: new Date("2030-09-01T14:00:00.000Z"),
        expiresAt: new Date("2030-09-01T14:00:00.000Z"),
        status: "active",
        seats: 1,
      },
    });
    expect((await block(first.id, second.id)).status).toBe(200);

    const feed = await app.request("/api/v1/ride-requests/feed", {
      headers: headersFor(first.id),
    });
    const feedBody = (await feed.json()) as {
      items: Array<{ fromCity: { id: string } }>;
    };
    expect(feed.status).toBe(200);
    expect(feedBody.items.map((item) => item.fromCity.id)).not.toContain(
      fromCity.id,
    );

    await notifyMatchingRideRequests({
      id: firstTripId,
      driverId: first.id,
      fromCity: fromCity.name,
      toCity: toCity.name,
      price: 500,
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      departureAt: new Date("2030-09-01T09:00:00.000Z"),
      durationMinutes: 120,
      matchingEnabled: true,
    });
    expect(
      await db.notification.count({
        where: { userId: second.id, type: "ride_request_match" },
      }),
    ).toBe(0);
  });
});
