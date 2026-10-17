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

/**
 * F1: те же правила приватности в списках броней.
 *
 * `GET /bookings/my` и `GET /bookings/history` собирают поездку через тот же
 * `serializeTrip`, но раньше звали его БЕЗ опций, а дефолт был fail-OPEN
 * («отдаём, если не сказали false»). /bookings/history при этом явно
 * выбирает ещё и `{status: "declined"}` — то есть отклонённый пассажир
 * получал в своём ответе точный адрес встречи и госномер машины водителя,
 * который его ждал.
 *
 * Здесь закреплено правило «водитель ИЛИ неистёкшая активная
 * (pending/confirmed) бронь» — ровно то, что уже держит GET /trips/:id —
 * и для обоих списков, включая падение дефолта (fail-closed) в самом
 * сериализаторе: новый вызов без опций больше не может утечь адрес.
 *
 * Те же паттерны, что выше: app.request(), dev-авторизация mock-токеном
 * (tests/dev-mock-auth.ts), уникальные telegramUserId.
 */
describe("GET /bookings/my и /bookings/history — address visibility", () => {
  const createdUserIds: string[] = [];
  const createdTripIds: string[] = [];
  // telegramUserId — BigInt: счётчик, а не Date.now() (выходит за 32 бита).
  let tgSeq = 1_800_000n;

  const PLATE = "А123ВС77";
  const FROM_ADDRESS = "м. Тёплый Стан, выход 4";
  const TO_ADDRESS = "Торговый центр на пр. Ленина";

  const createUser = async (name: string, withCar: boolean) => {
    const user = await db.user.create({
      data: {
        name: `${name}-${tgSeq}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=5",
        ...(withCar
          ? {
              car: {
                create: { model: "Kia Rio", color: "белый", plate: PLATE },
              },
            }
          : {}),
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const createTrip = async (
    driverId: string,
    departureAt: Date,
    status: "active" | "completed" = "active",
  ) => {
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: FROM_ADDRESS,
        toCity: "Тула",
        toAddress: TO_ADDRESS,
        departureAt,
        durationMinutes: 180,
        distanceKm: 180,
        price: 800,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
        status,
      },
    });
    createdTripIds.push(trip.id);
    return trip;
  };

  const getBookings = async (path: string, userId: string) => {
    const res = await app.request(`/api/v1/bookings${path}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` },
    });
    // Ответ обязан пройти safeParse в роуте: дрейф контракта — это 500
    // с логом, а не тихая порча на клиенте (MEMORY.md §18).
    expect(res.status).toBe(200);
    return res.json();
  };

  const findItem = (items: Array<{ trip: { id: string } }>, tripId: string) =>
    items.find((item) => item.trip.id === tripId);

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId: { in: createdTripIds } } });
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTripIds.length = 0;
    createdUserIds.length = 0;
  });

  // ── /bookings/history: declined — это и есть исходная утечка F1 ──────

  it("declined booking in /bookings/history exposes no addresses and no plate", async () => {
    const driver = await createUser("HistDeclinedDriver", true);
    const passenger = await createUser("HistDeclinedPassenger", false);
    // Поездка в будущем и активна — попадает в историю ИМЕННО из-за
    // ветки `{status: "declined"}`, а не из-за «поездка прошла».
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );
    await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "declined" },
    });

    const items = await getBookings("/history", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBeUndefined();
    expect(item.trip.toAddress).toBeUndefined();
    expect(item.trip.driver.car?.plate).toBeUndefined();
  });

  it("cancelled booking in /bookings/history exposes no addresses and no plate", async () => {
    const driver = await createUser("HistCancelledDriver", true);
    const passenger = await createUser("HistCancelledPassenger", false);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() - 86_400_000),
    );
    await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "cancelled" },
    });

    const items = await getBookings("/history", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBeUndefined();
    expect(item.trip.toAddress).toBeUndefined();
    expect(item.trip.driver.car?.plate).toBeUndefined();
  });

  // ── /bookings/my: активная бронь права участника сохраняет ───────────

  it("confirmed booking in /bookings/my keeps addresses and plate", async () => {
    const driver = await createUser("MyConfirmedDriver", true);
    const passenger = await createUser("MyConfirmedPassenger", false);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );
    await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 2, status: "confirmed" },
    });

    const items = await getBookings("/my", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBe(FROM_ADDRESS);
    expect(item.trip.toAddress).toBe(TO_ADDRESS);
    expect(item.trip.driver.car?.plate).toBe(PLATE);
  });

  it("non-expired pending booking in /bookings/my keeps addresses", async () => {
    const driver = await createUser("MyPendingDriver", true);
    const passenger = await createUser("MyPendingPassenger", false);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );
    await db.booking.create({
      data: {
        tripId: trip.id,
        passengerId: passenger.id,
        seat: 3,
        status: "pending",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const items = await getBookings("/my", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBe(FROM_ADDRESS);
    expect(item.trip.toAddress).toBe(TO_ADDRESS);
  });

  it("expired (un-swept) pending booking in /bookings/my gets no addresses", async () => {
    const driver = await createUser("MyExpiredDriver", true);
    const passenger = await createUser("MyExpiredPassenger", false);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );
    await db.booking.create({
      data: {
        tripId: trip.id,
        passengerId: passenger.id,
        seat: 1,
        status: "pending",
        // Просрочена, но воркер её ещё не вымел: прав участника не даёт
        // (тот же expiry-aware предикат, что у GET /trips/:id).
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const items = await getBookings("/my", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBeUndefined();
    expect(item.trip.toAddress).toBeUndefined();
    expect(item.trip.driver.car?.plate).toBeUndefined();
  });

  it("confirmed booking of a completed trip in /bookings/history keeps addresses", async () => {
    const driver = await createUser("HistDoneDriver", true);
    const passenger = await createUser("HistDonePassenger", false);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() - 86_400_000),
      "completed",
    );
    await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "confirmed" },
    });

    const items = await getBookings("/history", passenger.id);
    const item = findItem(items, trip.id);
    expect(item).toBeDefined();
    expect(item.trip.fromAddress).toBe(FROM_ADDRESS);
    expect(item.trip.toAddress).toBe(TO_ADDRESS);
  });

  // ── Ответы роутов, адресуемые только водителю: fail-closed их не ломает ──

  it("PATCH /trips/:id response to the driver keeps addresses and plate", async () => {
    const driver = await createUser("PatchDriver", true);
    const trip = await createTrip(
      driver.id,
      new Date(Date.now() + 86_400_000),
    );

    const res = await app.request(`/api/v1/trips/${trip.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${devMockAccessToken(driver.id)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ price: 900 }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.fromAddress).toBe(FROM_ADDRESS);
    expect(body.toAddress).toBe(TO_ADDRESS);
    expect(body.driver.car?.plate).toBe(PLATE);
  });

  it("driver's /bookings/trip view hides the passenger's car plate (own-context only)", async () => {
    const driver = await createUser("PlateDriver", true);
    const passenger = await createUser("PlatePassenger", true);
    const trip = await createTrip(driver.id, new Date(Date.now() + 86_400_000));
    await db.booking.create({
      data: { tripId: trip.id, passengerId: passenger.id, seat: 1, status: "pending" },
    });

    // Водитель видит заявку, но номер чужой машины пассажира — нет
    // (plate fail-closed: только own-контекст).
    const res = await app.request(`/api/v1/bookings/trip/${trip.id}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driver.id)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find(
      (i: { trip: { id: string } }) => i.trip.id === trip.id,
    );
    expect(item).toBeDefined();
    expect(item.passenger.car?.plate).toBeUndefined();

    // А своё авто пассажир по-прежнему видит в /bookings/my.
    const mine = await getBookings("/my", passenger.id);
    expect(findItem(mine, trip.id).passenger.car?.plate).toBe(PLATE);
  });
});

