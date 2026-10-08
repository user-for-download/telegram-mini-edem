import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processExpiredTrips } from "../../src/workers/tripWorker.js";
import { db } from "../../src/db.js";
import { PENDING_BOOKING_TTL_MS } from "../../src/bookings/shared.js";

/**
 * Срок автозавершения поездки (опция владельца в форме).
 *
 * Что здесь зафиксировано (каждое «не» — тоже контракт):
 * - `autoComplete = true` → поездка завершается по ОКОНЧАНИЮ рейса;
 * - `autoComplete = true`, рейс ещё идёт → поездка НЕ завершается;
 * - `autoComplete = false` → прежнее поведение: через `PENDING_BOOKING_TTL_MS`
 *   после отправления, и не раньше;
 * - опция НЕ меняет сам факт автозавершения: выключенная поездка так же
 *   «протухает», просто по старому правилу;
 * - поездка длиннее суток с `autoComplete = true` НЕ завершается по TTL,
 *   пока рейс идёт (разделение проходов — условие корректности);
 * - обе ветки завершают поездку ОДНИМ кодом: pending-брони отклоняются,
 *   `tripsCount` водителю инкрементится, статус → `completed`.
 *
 * Даты относительные: абсолютный «2029» перестал бы быть прошлым вместе с
 * системными часами, и «не завершается до конца рейса» превратилось бы в
 * «завершается раньше».
 */

const HOUR = 3_600_000;
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * HOUR);
let tgSeq = 8_400_000n;

interface Created {
  id: string;
}

describe("tripWorker: срок автозавершения", () => {
  let driverId: string;
  let cityA: string;
  let cityB: string;
  let tripIds: string[] = [];

  beforeEach(async () => {
    const unique = `Worker driver-${++tgSeq}`;
    const driver = await db.user.create({
      data: { name: unique, telegramUserId: tgSeq, avatar: "" },
    });
    driverId = driver.id;
    await db.car.create({
      data: { userId: driverId, model: "Test", color: "Black" },
    });
    cityA = (
      await db.city.create({
        data: { name: `Worker from ${tgSeq}`, nameNormalized: `w-from-${tgSeq}` },
      })
    ).id;
    cityB = (
      await db.city.create({
        data: { name: `Worker to ${tgSeq}`, nameNormalized: `w-to-${tgSeq}` },
      })
    ).id;
    tripIds = [];
  });

  afterEach(async () => {
    await db.notification.deleteMany({ where: { userId: driverId } });
    await db.booking.deleteMany({ where: { tripId: { in: tripIds } } });
    await db.trip.deleteMany({ where: { id: { in: tripIds } } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: driverId } });
    await db.city.deleteMany({ where: { id: { in: [cityA, cityB] } } });
  });

  async function createTrip(params: {
    autoComplete: boolean;
    /** Отправление «назад», чтобы поездка была в прошлом для воркера. */
    hoursAgo: number;
    durationHours: number;
  }): Promise<Created> {
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: `Worker from ${tgSeq}`,
        fromAddress: "ул. Отправления, 1",
        toCity: `Worker to ${tgSeq}`,
        toAddress: "ул. Назначения, 2",
        fromCityId: cityA,
        toCityId: cityB,
        departureAt: new Date(Date.now() - params.hoursAgo * HOUR),
        durationMinutes: params.durationHours * 60,
        distanceKm: 120,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 2,
        status: "active",
        autoComplete: params.autoComplete,
        tags: [],
      },
    });
    tripIds.push(trip.id);
    return { id: trip.id };
  }

  async function statusOf(id: string): Promise<string | null> {
    const row = await db.trip.findUnique({ where: { id } });
    return row?.status ?? null;
  }

  it("autoComplete завершает поездку по окончании рейса, не дожидаясь TTL", async () => {
    // Отправление 2 часа назад, рейс 1 час → рейс закончился час назад.
    // TTL-правило (+24ч) ещё не наступило, поэтому завершить может только
    // opt-in проход.
    const trip = await createTrip({
      autoComplete: true,
      hoursAgo: 2,
      durationHours: 1,
    });

    await processExpiredTrips();

    expect(await statusOf(trip.id)).toBe("completed");
  });

  it("autoComplete НЕ завершает поездку, пока рейс идёт", async () => {
    // Отправление 1 час назад, рейс 5 часов → конца ещё нет.
    const trip = await createTrip({
      autoComplete: true,
      hoursAgo: 1,
      durationHours: 5,
    });

    await processExpiredTrips();

    expect(await statusOf(trip.id)).toBe("active");
  });

  it("autoComplete=false сохраняет прежнее правило: ждёт TTL", async () => {
    // Рейс закончился час назад, TTL (+24ч) не наступил → поездка обязана
    // висеть. Та же поездка, что в первом тесте, но с выключенной опцией:
    // различает опция, а не форма поездки.
    const trip = await createTrip({
      autoComplete: false,
      hoursAgo: 2,
      durationHours: 1,
    });

    await processExpiredTrips();

    expect(await statusOf(trip.id)).toBe("active");
  });

  it("autoComplete=false завершает поездку после TTL", async () => {
    const hoursAgo = Math.floor(PENDING_BOOKING_TTL_MS / HOUR) + 2;
    const trip = await createTrip({
      autoComplete: false,
      hoursAgo,
      durationHours: 1,
    });

    await processExpiredTrips();

    expect(await statusOf(trip.id)).toBe("completed");
  });

  it("поездка длиннее суток с autoComplete не завершается TTL-проходом", async () => {
    // Регрессия на разделение проходов. Отправление 26 часов назад, рейс 30
    // часов: TTL-отсечка (24ч) прошла, а рейс ещё идёт. Если бы дефолтный
    // проход не исключал autoComplete-поездки, она завершилась бы, пока
    // водитель в дороге.
    const trip = await createTrip({
      autoComplete: true,
      hoursAgo: 26,
      durationHours: 30,
    });

    await processExpiredTrips();

    expect(await statusOf(trip.id)).toBe("active");
  });

  it("один проход завершает поездку РОВНО один раз — tripsCount не двоится", async () => {
    // Оба прохода видят кандидата в один тик (opt-in ловит по концу рейса,
    // дефолтный исключает autoComplete) — но завершить должна поездку одна
    // ветка. Двойной инкремент счётчика означал бы двух поездок у юзера.
    const trip = await createTrip({
      autoComplete: true,
      hoursAgo: 3,
      durationHours: 1,
    });
    const before = await db.user.findUniqueOrThrow({
      where: { id: driverId },
      select: { tripsCount: true },
    });

    await processExpiredTrips();
    // Второй тик: поездка уже completed, повторно закрываться нечему.
    await processExpiredTrips();

    const after = await db.user.findUniqueOrThrow({
      where: { id: driverId },
      select: { tripsCount: true },
    });
    expect(after.tripsCount).toBe(before.tripsCount + 1);
    expect(await statusOf(trip.id)).toBe("completed");
  });

  it("opt-in ветка отклоняет pending-брони тем же кодом, что и TTL", async () => {
    // Набор действий не должен расходиться между ветками: иначе у
    // «завершённой по окончании рейса» поездки остались бы pending-заявки.
    const trip = await createTrip({
      autoComplete: true,
      hoursAgo: 2,
      durationHours: 1,
    });
    const booking = await db.booking.create({
      data: {
        tripId: trip.id,
        passengerId: driverId,
        seat: 1,
        status: "pending",
        expiresAt: FAR_FUTURE,
      },
    });

    await processExpiredTrips();

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.status).toBe("declined");
    const completed = await db.trip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    // Места освобождаются, как и у TTL-ветки.
    expect(completed.seatsAvailable).toBe(0);
  });
});
