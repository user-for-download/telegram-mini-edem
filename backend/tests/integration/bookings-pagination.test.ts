import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Cursor-based пагинация GET /bookings/trip/:tripId.
 *
 * Паттерны репо (см. smoke.test.ts): app.request() вместо supertest,
 * dev-авторизация mock-токеном (tests/dev-mock-auth.js: allowlist + TTL),
 * уникальные telegramUserId.
 */
describe("GET /bookings/trip/:tripId — cursor pagination", () => {
  let driverId: string;
  let tripId: string;
  const passengerIds: string[] = [];
  // Пользователи/поездки, созданные ОТДЕЛЬНО внутри отдельных тестов
  // (курсор чужой поездки, не-водитель). Их тоже нужно чистить: БД общая
  // для всех сьютов, а tgSeq начинается заново при каждом запуске файла —
  // оставленная строка ломала бы СЛЕДУЮЩИЙ прогон уникальным индексом.
  const extraUserIds: string[] = [];
  const extraTripIds: string[] = [];
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  let tgSeq = 1_600_000n;

  beforeEach(async () => {
    const driver = await db.user.create({
      data: {
        name: `Driver-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });
    driverId = driver.id;

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Moscow",
        fromAddress: "Center",
        toCity: "SPb",
        toAddress: "Station",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 120,
        distanceKm: 700,
        price: 1500,
        seatsTotal: 3,
        seatsAvailable: 4,
        tags: [],
      },
    });
    tripId = trip.id;

    // 15 заявок с убывающими createdAt.
    // Архивные заявки позволяют проверить pagination, не нарушая
    // продуктовый лимит в три места и active-seat unique index.
    // Места 1..3 — в границах MAX_SEATS (ответ эндпоинта валидируется
    // контрактом и fail-closed отвергнет seat > MAX_SEATS).
    for (let i = 0; i < 15; i++) {
      const passenger = await db.user.create({
        data: {
          name: `Passenger-${i}-${Date.now()}`,
          telegramUserId: ++tgSeq,
          avatar: "https://i.pravatar.cc/200?img=4",
        },
      });
      passengerIds.push(passenger.id);

      await db.booking.create({
        data: {
          tripId,
          passengerId: passenger.id,
          seat: (i % 3) + 1,
          status: "cancelled",
          createdAt: new Date(Date.now() - i * 1000),
        },
      });
    }
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.booking.deleteMany({ where: { tripId: { in: extraTripIds } } });
    await db.trip.deleteMany({ where: { id: { in: extraTripIds } } });
    await db.user.deleteMany({
      where: { id: { in: [driverId, ...passengerIds, ...extraUserIds] } },
    });
    passengerIds.length = 0;
    extraUserIds.length = 0;
    extraTripIds.length = 0;
  });

  it("requires authentication", async () => {
    const res = await app.request(`/api/v1/bookings/trip/${tripId}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent trip", async () => {
    const fakeUuid = "22222222-2222-2222-2222-222222222222";
    const res = await app.request(`/api/v1/bookings/trip/${fakeUuid}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-driver", async () => {
    const otherUser = await db.user.create({
      data: {
        name: `Other-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=5",
      },
    });

    try {
      const res = await app.request(`/api/v1/bookings/trip/${tripId}`, {
        headers: { Authorization: `Bearer ${devMockAccessToken(otherUser.id)}` },
      });
      expect(res.status).toBe(403);
    } finally {
      await db.user.deleteMany({ where: { id: otherUser.id } });
    }
  });

  it("returns first page with custom limit and hasMore", async () => {
    const res = await app.request(`/api/v1/bookings/trip/${tripId}?limit=5`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeDefined();
    expect(body.pagination.limit).toBe(5);
  });

  it("defaults limit to 50 and returns everything in one page", async () => {
    const res = await app.request(`/api/v1/bookings/trip/${tripId}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(15);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
  });

  it("traverses pages via cursor without overlap", async () => {
    const page1 = await (
      await app.request(`/api/v1/bookings/trip/${tripId}?limit=10`, {
        headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
      })
    ).json();

    expect(page1.items).toHaveLength(10);
    expect(page1.pagination.hasMore).toBe(true);

    const page2 = await (
      await app.request(
        `/api/v1/bookings/trip/${tripId}?limit=10&cursor=${page1.pagination.nextCursor}`,
        { headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` } }
      )
    ).json();

    expect(page2.items).toHaveLength(5);
    expect(page2.pagination.hasMore).toBe(false);
    expect(page2.pagination.nextCursor).toBeNull();

    const page1Ids = new Set(page1.items.map((b: { id: string }) => b.id));
    for (const item of page2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
  });

  it("returns empty page with 200 for a valid-format expired cursor", async () => {
    const fakeUuid = "33333333-3333-3333-3333-333333333333";
    const res = await app.request(`/api/v1/bookings/trip/${tripId}?cursor=${fakeUuid}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("rejects invalid cursor format with 400", async () => {
    const res = await app.request(`/api/v1/bookings/trip/${tripId}?cursor=bad`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` },
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  /**
   * Регрессия F9: курсор ЧУЖОЙ поездки.
   *
   * Раньше такой курсор проходил: строка отсекалась фильтром
   * `where: { tripId }`, но `skip: 1` (идиома Prisma «пропустить строку-курсор»)
   * всё равно выбрасывал одну честную запись ЭТОЙ поездки — пагинация молча
   * теряла элемент и уезжала на сдвинутую позицию, без единой ошибки.
   *
   * Существующий, но «протухший» курсор (строки уже нет) такому НЕ является:
   * он даёт пустой хвост с 200 — это закреплено тестом выше и ломать
   * нельзя.
   */
  it("rejects a cursor that belongs to ANOTHER trip with 400", async () => {
    const otherDriver = await db.user.create({
      data: {
        name: `OtherDriver-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=4",
      },
    });
    extraUserIds.push(otherDriver.id);
    const otherTrip = await db.trip.create({
      data: {
        driverId: otherDriver.id,
        fromCity: "Kazan",
        fromAddress: "Center",
        toCity: "Omsk",
        toAddress: "Station",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 60,
        distanceKm: 900,
        price: 900,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    extraTripIds.push(otherTrip.id);
    const foreignBooking = await db.booking.create({
      data: {
        tripId: otherTrip.id,
        passengerId: passengerIds[0],
        seat: 1,
        status: "declined",
        cancelledAt: new Date(),
        cancelledByType: "driver",
      },
    });

    const res = await app.request(
      `/api/v1/bookings/trip/${tripId}?cursor=${foreignBooking.id}&limit=5`,
      { headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` } },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("404/403 on this route carry the machine-readable `code` (ApiErrorBody)", async () => {
    const missing = await app.request(
      "/api/v1/bookings/trip/99999999-9999-9999-9999-999999999999",
      { headers: { Authorization: `Bearer ${devMockAccessToken(driverId)}` } },
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");

    const otherDriver = await db.user.create({
      data: {
        name: `Stranger-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=5",
      },
    });
    extraUserIds.push(otherDriver.id);
    const forbidden = await app.request(`/api/v1/bookings/trip/${tripId}`, {
      headers: { Authorization: `Bearer ${devMockAccessToken(otherDriver.id)}` },
    });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe("FORBIDDEN");
  });
});

