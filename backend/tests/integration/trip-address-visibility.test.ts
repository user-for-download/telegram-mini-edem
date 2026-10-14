import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Видимость точных адресов встречи в GET /trips/:id.
 *
 * Приватность: адреса видят только участники поездки —
 * водитель и пользователи с активной бронью (pending/confirmed).
 * Остальным поля fromAddress/toAddress не отдаются вовсе
 * (раньше туда подставлялся город и возникали дубли «Москва / Москва»).
 *
 * Паттерны репо (см. smoke.test.ts): app.request() вместо supertest,
 * dev-авторизация mock-токеном (tests/dev-mock-auth.js: allowlist + TTL),
 * уникальные telegramUserId.
 */
describe("GET /trips/:id — address visibility", () => {
  let driverId: string;
  let tripId: string;
  const createdUserIds: string[] = [];
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  let tgSeq = 1_700_000n;

  const createTripForDriver = async () => {
    const driver = await db.user.create({
      data: {
        name: `AddrDriver-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });
    driverId = driver.id;
    createdUserIds.push(driver.id);

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан, выход 4",
        toCity: "Тула",
        toAddress: "Торговый центр на пр. Ленина",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 180,
        distanceKm: 180,
        price: 800,
        seatsTotal: 3,
        seatsAvailable: 4,
        tags: [],
      },
    });
    tripId = trip.id;
  };

  const createUser = async (name: string) => {
    const user = await db.user.create({
      data: {
        name: `${name}-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=5",
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const getTripDetails = async (userId?: string) => {
    const res = await app.request(`/api/v1/trips/${tripId}`, {
      headers: userId ? { Authorization: `Bearer ${devMockAccessToken(userId)}` } : {},
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  beforeEach(async () => {
    await createTripForDriver();
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  it("driver sees exact meeting addresses of own trip", async () => {
    const body = await getTripDetails(driverId);
    expect(body.fromAddress).toBe("м. Тёплый Стан, выход 4");
    expect(body.toAddress).toBe("Торговый центр на пр. Ленина");
  });

  it("unauthenticated requester gets no addresses", async () => {
    const body = await getTripDetails();
    expect(body.fromCity).toBe("Москва");
    expect(body.toCity).toBe("Тула");
    expect(body.fromAddress).toBeUndefined();
    expect(body.toAddress).toBeUndefined();
  });

  it("authenticated stranger without booking gets no addresses", async () => {
    const stranger = await createUser("Stranger");
    const body = await getTripDetails(stranger.id);
    expect(body.fromAddress).toBeUndefined();
    expect(body.toAddress).toBeUndefined();
  });

  it("passenger with pending booking sees addresses", async () => {
    const passenger = await createUser("PendingPassenger");
    await db.booking.create({
      data: { tripId, passengerId: passenger.id, seat: 1, status: "pending" },
    });
    const body = await getTripDetails(passenger.id);
    expect(body.fromAddress).toBe("м. Тёплый Стан, выход 4");
    expect(body.toAddress).toBe("Торговый центр на пр. Ленина");
  });

  it("passenger with confirmed booking sees addresses", async () => {
    const passenger = await createUser("ConfirmedPassenger");
    await db.booking.create({
      data: { tripId, passengerId: passenger.id, seat: 2, status: "confirmed" },
    });
    const body = await getTripDetails(passenger.id);
    expect(body.fromAddress).toBe("м. Тёплый Стан, выход 4");
    expect(body.toAddress).toBe("Торговый центр на пр. Ленина");
  });

  it("passenger with cancelled booking gets no addresses", async () => {
    const passenger = await createUser("CancelledPassenger");
    await db.booking.create({
      data: { tripId, passengerId: passenger.id, seat: 3, status: "cancelled" },
    });
    const body = await getTripDetails(passenger.id);
    expect(body.fromAddress).toBeUndefined();
    expect(body.toAddress).toBeUndefined();
  });

  it("passenger with expired (un-swept) pending booking gets no addresses", async () => {
    const passenger = await createUser("ExpiredPassenger");
    await db.booking.create({
      data: {
        tripId,
        passengerId: passenger.id,
        seat: 3,
        status: "pending",
        // Просрочена, но воркер её ещё не вымел: права участника не даёт.
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const body = await getTripDetails(passenger.id);
    expect(body.fromAddress).toBeUndefined();
    expect(body.toAddress).toBeUndefined();
  });

  it("public trips list never exposes addresses", async () => {
    const res = await app.request("/api/v1/trips?limit=50");
    expect(res.status).toBe(200);

    const body = await res.json();
    const listed = body.items.find((t: { id: string }) => t.id === tripId);
    expect(listed).toBeDefined();
    expect(listed.fromAddress).toBeUndefined();
    expect(listed.toAddress).toBeUndefined();
  });
});
