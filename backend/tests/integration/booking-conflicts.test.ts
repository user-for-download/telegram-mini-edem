import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * P2002-конфликты при бронировании: идемпотентный retry, SEAT_TAKEN,
 * ALREADY_BOOKED, повторная подача после declined/cancelled (F15),
 * гонка параллельных броней.
 *
 * Partial unique индексы (active_seat_booking, active_passenger_booking)
 * создаются SQL-миграцией — в тестовую БД (db push) они не попадают,
 * поэтому применяем их здесь идемпотентно (IF NOT EXISTS).
 *
 * Паттерны репо (см. smoke.test.ts): app.request() вместо supertest,
 * dev-авторизация mock-токеном (tests/dev-mock-auth.js: allowlist + TTL),
 * уникальные telegramUserId.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

describe("POST /api/v1/bookings — P2002 conflict handling", () => {
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  let tgSeq = 3_100_000n;
  let driverId: string;
  let passenger1Id: string;
  let passenger2Id: string;
  let tripId: string;
  // Дополнительные поездки, созданные внутри отдельных тестов (F3).
  const extraTripIds: string[] = [];

  beforeAll(async () => {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Trip"
        DROP CONSTRAINT IF EXISTS "Trip_seatsTotal_range",
        DROP CONSTRAINT IF EXISTS "Trip_seatsAvailable_nonnegative",
        DROP CONSTRAINT IF EXISTS "Trip_price_positive"
    `);
    await db.$executeRawUnsafe(`
      ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_seat_positive"
    `);
    await db.$executeRawUnsafe(`
      ALTER TABLE "Trip"
        ADD CONSTRAINT "Trip_seatsTotal_range" CHECK ("seatsTotal" >= 1 AND "seatsTotal" <= 3),
        ADD CONSTRAINT "Trip_seatsAvailable_nonnegative" CHECK ("seatsAvailable" >= 0),
        ADD CONSTRAINT "Trip_price_positive" CHECK ("price" > 0)
    `);
    await db.$executeRawUnsafe(`
      ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seat_positive" CHECK ("seat" >= 1)
    `);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "active_seat_booking"
        ON "Booking"("tripId", "seat")
        WHERE "status" IN ('pending', 'confirmed')
    `);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "active_passenger_booking"
        ON "Booking"("tripId", "passengerId")
        WHERE "status" IN ('pending', 'confirmed')
    `);
  });

  async function createUser(name: string): Promise<string> {
    const user = await db.user.create({
      data: {
        name: `${name}-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=9",
      },
    });
    return user.id;
  }

  beforeEach(async () => {
    driverId = await createUser("Driver");
    passenger1Id = await createUser("P1");
    passenger2Id = await createUser("P2");

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "Тверская 1",
        toCity: "СПб",
        toAddress: "Невский 1",
        departureAt: new Date("2030-06-01T09:00:00Z"),
        durationMinutes: 420,
        distanceKm: 700,
        price: 2000,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    if (extraTripIds.length > 0) {
      await db.booking.deleteMany({ where: { tripId: { in: extraTripIds } } });
      await db.trip.deleteMany({ where: { id: { in: extraTripIds } } });
      extraTripIds.length = 0;
    }
    await db.user.deleteMany({ where: { id: { in: [driverId, passenger1Id, passenger2Id] } } });
  });

  /**
   * Ответ POST /bookings — объединение форм успеха и конфликта:
   * успех → DTO брони (id/seat/status), 409 → { code, message }.
   * Явная форма вместо `any` (audit: type safety in tests).
   */
  type BookingResponse = {
    id?: string;
    seat?: number;
    status?: string;
    code?: string;
    message?: string;
  };

  async function book(
    passengerId: string,
    seat: number
  ): Promise<{ status: number; body: BookingResponse }> {
    const res = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(passengerId)}`,
      },
      body: JSON.stringify({ tripId, seat }),
    });
    return { status: res.status, body: (await res.json()) as BookingResponse };
  }

  /**
   * То же, но для поездки из конкретного теста (F3): поездка на 1 место
   * нужна, чтобы seatsAvailable стал 0 уже первой бронью.
   */
  async function bookOn(
    passengerId: string,
    targetTripId: string,
    seat: number
  ): Promise<{ status: number; body: BookingResponse }> {
    const res = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(passengerId)}`,
      },
      body: JSON.stringify({ tripId: targetTripId, seat }),
    });
    return { status: res.status, body: (await res.json()) as BookingResponse };
  }

  /** Поездка с заданным числом мест; убирается в afterEach. */
  async function createTrip(seatsTotal: number): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "Тверская 1",
        toCity: "СПб",
        toAddress: "Невский 1",
        departureAt: new Date("2030-06-01T09:00:00Z"),
        durationMinutes: 420,
        distanceKm: 700,
        price: 2000,
        seatsTotal,
        seatsAvailable: seatsTotal,
        tags: [],
      },
    });
    extraTripIds.push(trip.id);
    return trip.id;
  }

  // Отклонение брони водителем через API (полный цикл F15: место
  // освобождается, слот снова доступен для бронирования).
  async function declineAsDriver(bookingId: string): Promise<number> {
    const res = await app.request(`/api/v1/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify({ status: "declined" }),
    });
    return res.status;
  }

  it("returns 200 with the existing booking on idempotent retry (same passenger, same seat)", async () => {
    // Бронь уже существует (первый запрос создал её, но клиент получил
    // таймаут и повторил запрос).
    const existing = await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "pending" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    const { status, body } = await book(passenger1Id, 1);

    expect(status).toBe(200);
    expect(body.id).toBe(existing.id);
    expect(body.seat).toBe(1);
    expect(body.status).toBe("pending");

    // Место не «съелось» повторно — бронь ровно одна.
    const count = await db.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  // F3: псевдо-идемпотентность проверяется ДО guard'а остатка мест.
  it("F3: retry of an identical booking on a full 1-seat trip returns the existing booking (200)", async () => {
    const soloTripId = await createTrip(1);

    const first = await bookOn(passenger1Id, soloTripId, 1);
    expect(first.status).toBe(201);

    // Первая бронь исчерпала единственное место.
    const afterFirst = await db.trip.findUnique({ where: { id: soloTripId } });
    expect(afterFirst?.seatsAvailable).toBe(0);

    // Клиент потерял ответ 201 и повторил запрос буквально тем же телом.
    const retry = await bookOn(passenger1Id, soloTripId, 1);

    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const count = await db.booking.count({
      where: { tripId: soloTripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  it("F3: another passenger still gets 409 CONFLICT for the last seat of a full trip", async () => {
    const soloTripId = await createTrip(1);
    expect((await bookOn(passenger1Id, soloTripId, 1)).status).toBe(201);

    const other = await bookOn(passenger2Id, soloTripId, 1);

    expect(other.status).toBe(409);
    // Код/текст для ЧУЖИХ не менялись: остаток мест по-прежнему первый.
    expect(other.body.code).toBe("CONFLICT");
    expect(other.body.message).toBe("Not enough available seats");
  });

  it("F3: a brand-new booking on a full trip keeps 409 CONFLICT even for a free slot", async () => {
    const twoSeatTripId = await createTrip(2);
    expect((await bookOn(passenger1Id, twoSeatTripId, 1)).status).toBe(201);

    // Слот 2 свободен, но счётчик мест исчерпан (вторую бронь не создавали).
    await db.trip.update({
      where: { id: twoSeatTripId },
      data: { seatsAvailable: 0 },
    });

    const res = await bookOn(passenger2Id, twoSeatTripId, 2);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.message).toBe("Not enough available seats");
  });

  it("returns 409 SEAT_TAKEN when another passenger books the same seat", async () => {
    await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "pending" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    const { status, body } = await book(passenger2Id, 1);

    expect(status).toBe(409);
    expect(body.code).toBe("SEAT_TAKEN");
  });

  it("returns 409 ALREADY_BOOKED when the same passenger books a different seat", async () => {
    await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "pending" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    const { status, body } = await book(passenger1Id, 2);

    expect(status).toBe(409);
    expect(body.code).toBe("ALREADY_BOOKED");
  });

  it("allows re-booking a seat after the previous booking was cancelled (partial index)", async () => {
    await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "pending" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });
    // Бронь отменена — слот освобождается (partial unique игнорирует cancelled).
    await db.booking.updateMany({
      where: { tripId, passengerId: passenger1Id },
      data: { status: "cancelled" },
    });

    const { status } = await book(passenger1Id, 1);

    expect(status).toBe(201);
  });

  it("allows re-booking the same seat after the driver declined it (F15)", async () => {
    // Полный цикл через API: бронь → отклонение водителем → повторная подача.
    const first = await book(passenger1Id, 1);
    expect(first.status).toBe(201);

    expect(await declineAsDriver(first.body.id)).toBe(200);

    const { status } = await book(passenger1Id, 1);
    expect(status).toBe(201);

    // Активная бронь ровно одна — дубликат не создался.
    const count = await db.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  it("allows a different passenger to take the slot freed by a decline (F15)", async () => {
    const first = await book(passenger1Id, 1);
    expect(first.status).toBe(201);

    expect(await declineAsDriver(first.body.id)).toBe(200);

    const { status, body } = await book(passenger2Id, 1);
    expect(status).toBe(201);
    expect(body.seat).toBe(1);
    expect(body.status).toBe("pending");
  });

  it("expires a pending booking before accepting a new booking for its seat", async () => {
    const expired = await db.booking.create({
      data: {
        tripId,
        passengerId: passenger1Id,
        seat: 1,
        status: "pending",
        expiresAt: new Date(Date.now() - 1),
      },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    const { status, body } = await book(passenger2Id, 1);

    expect(status).toBe(201);
    expect(body.seat).toBe(1);

    const expiredInDb = await db.booking.findUnique({ where: { id: expired.id } });
    expect(expiredInDb?.status).toBe("declined");
    expect(expiredInDb?.cancelledByType).toBe("system");
    expect(expiredInDb?.cancellationReason).toBe("Booking request expired");
  });

  it("does not allow a driver to confirm an expired pending booking", async () => {
    const expired = await db.booking.create({
      data: {
        tripId,
        passengerId: passenger1Id,
        seat: 1,
        status: "pending",
        expiresAt: new Date(Date.now() - 1),
      },
    });

    const res = await app.request(`/api/v1/bookings/${expired.id}/status`, {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      body: JSON.stringify({ status: "confirmed" }),
    });

    expect(res.status).toBe(409);
    const booking = await db.booking.findUnique({ where: { id: expired.id } });
    expect(booking?.status).toBe("pending");
  });

  it("still blocks duplicates on confirmed bookings (F15)", async () => {
    await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "confirmed" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    // Чужое место занято подтверждённой бронью.
    const taken = await book(passenger2Id, 1);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("SEAT_TAKEN");

    // Своя подтверждённая бронь на другое место той же поездки.
    const own = await book(passenger1Id, 2);
    expect(own.status).toBe(409);
    expect(own.body.code).toBe("ALREADY_BOOKED");
  });

  it("rejects invalid price, trip seats, and booking seat at the database boundary", async () => {
    await expect(
      db.trip.create({
        data: {
          driverId,
          fromCity: "Москва",
          fromAddress: "Тверская 1",
          toCity: "СПб",
          toAddress: "Невский 1",
          departureAt: new Date("2030-06-01T09:00:00Z"),
          durationMinutes: 420,
          distanceKm: 700,
          price: 0,
          seatsTotal: 3,
          seatsAvailable: 3,
          tags: [],
        },
      })
    ).rejects.toThrow();

    await expect(
      db.trip.update({ where: { id: tripId }, data: { seatsTotal: 0 } })
    ).rejects.toThrow();

    await expect(
      db.booking.create({
        data: { tripId, passengerId: passenger1Id, seat: 0, status: "pending" },
      })
    ).rejects.toThrow();
  });

  it("returns 200 idempotent retry on own confirmed booking without duplicating (F15)", async () => {
    const existing = await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "confirmed" },
    });
    await db.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: { decrement: 1 } },
    });

    const { status, body } = await book(passenger1Id, 1);

    expect(status).toBe(200);
    expect(body.id).toBe(existing.id);

    const count = await db.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  it("concurrent identical bookings: exactly one wins, loser gets 200 or 409, one active row", async () => {
    const [r1, r2] = await Promise.all([
      book(passenger1Id, 1),
      book(passenger1Id, 1),
    ]);

    // Победитель всегда 201; проигравший — 200 (P2002 → идемпотентный
    // возврат существующей брони) или 409 (P2034 Serializable conflict).
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toContain(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(200);
    expect(statuses[1]).toBeLessThan(500);

    const count = await db.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    expect(count).toBe(1);
  });

  it("partial unique index exists and reports the violated index name on P2002 (DB level)", async () => {
    await db.booking.create({
      data: { tripId, passengerId: passenger1Id, seat: 1, status: "pending" },
    });

    await expect(
      db.booking.create({
        data: { tripId, passengerId: passenger2Id, seat: 1, status: "pending" },
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const e = error as Prisma.PrismaClientKnownRequestError;
      expect(e.code).toBe("P2002");
      // Prisma 7: в meta нет target (полей) — имя нарушенного индекса
      // лежит в meta.driverAdapterError.cause.constraint.index (сырые
      // данные PG-драйвера).
      const cause = (e.meta?.driverAdapterError as
        | { cause?: { originalCode?: string; constraint?: { index?: string } } }
        | undefined)?.cause;
      expect(cause?.originalCode).toBe("23505");
      expect(cause?.constraint?.index).toBe("active_seat_booking");
      return true;
    });
  });
});
