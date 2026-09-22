import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * F14: NULL-safety уникального ограничения Review.
 *
 * PostgreSQL в unique-индексе считает NULL «различным» со всеми остальными
 * значениями: полный индекс Review_authorId_tripId_targetUserId_key не
 * предотвращает дубли (authorId, targetUserId), когда tripId IS NULL
 * (legacy-отзывы, отзывы удалённых поездок — FK onDelete: SetNull).
 * Partial-индекс Review_authorId_targetUserId_nullTrip_key
 * ((authorId, targetUserId) WHERE tripId IS NULL) закрывает дыру.
 *
 * Как и partial-индексы бронирования (booking-conflicts.test.ts), он
 * создаётся SQL-миграцией и в тестовую БД (db push) не попадает —
 * применяем здесь идемпотентно (IF NOT EXISTS).
 *
 * Поведение:
 * - второй INSERT (authorId, targetUserId) с tripId NULL → P2002 на уровне
 *   БД (negative test: дубль с NULL в ключе больше невозможен);
 * - другой target (или другая поездка) — без конфликта;
 * - параллельные POST /reviews на один (author, trip, target): ровно один
 *   201, проигравший — 409 ALREADY_REVIEWED, никогда 500.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const DAY_MS = 24 * 60 * 60 * 1000;
const NULL_TRIP_INDEX = "Review_authorId_targetUserId_nullTrip_key";

describe("Review unique NULL-safety (F14)", () => {
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  // Диапазон 9_700_000+ не пересекается с другими integration-suite.
  let tgSeq = 9_700_000n;

  let driverId: string; // target отзыва (водитель поездки)
  let passengerId: string; // автор отзыва (подтверждённый пассажир)

  const createdUserIds: string[] = [];
  const createdTripIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdReviewIds: string[] = [];

  beforeAll(async () => {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_rating_range"
    `);
    await db.$executeRawUnsafe(`
      ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range"
        CHECK ("rating" >= 1 AND "rating" <= 5)
    `);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Review_authorId_targetUserId_nullTrip_key"
        ON "Review"("authorId", "targetUserId")
        WHERE "tripId" IS NULL
    `);
  });

  async function createUser(name: string): Promise<string> {
    const user = await db.user.create({
      data: {
        name: `${name}-${tgSeq + 1n}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=9",
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  // Прошедшая completed-поездка (driver = target): проходит проверки
  // POST /reviews («поездка уже началась/завершена», «не отменена»).
  async function createPastTrip(driverUserId: string): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId: driverUserId,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пр-т Ленина",
        departureAt: new Date(Date.now() - DAY_MS),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
        status: "completed",
      },
    });
    createdTripIds.push(trip.id);
    return trip.id;
  }

  async function createBooking(tripId: string, passengerUserId: string): Promise<string> {
    const booking = await db.booking.create({
      data: { tripId, passengerId: passengerUserId, seat: 1, status: "confirmed", comment: "" },
    });
    createdBookingIds.push(booking.id);
    return booking.id;
  }

  // Отзыв напрямую в БД; tripId опционально — без него tripId IS NULL.
  async function createReviewDirect(
    authorId: string,
    targetUserId: string,
    rating: number,
    tripId?: string
  ): Promise<string> {
    const review = await db.review.create({
      data: {
        authorId,
        targetUserId,
        targetRole: "driver",
        rating,
        text: `Отзыв с оценкой ${rating}`,
        tripRoute: "Москва → Тула",
        status: "pending",
        ...(tripId ? { tripId } : {}),
      },
    });
    createdReviewIds.push(review.id);
    return review.id;
  }

  beforeEach(async () => {
    driverId = await createUser("NullTripDriver");
    passengerId = await createUser("NullTripPassenger");
  });

  afterEach(async () => {
    if (createdBookingIds.length > 0) {
      await db.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
      createdBookingIds.length = 0;
    }
    if (createdReviewIds.length > 0) {
      await db.review.deleteMany({ where: { id: { in: createdReviewIds } } });
      createdReviewIds.length = 0;
    }
    if (createdTripIds.length > 0) {
      await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
      createdTripIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  it("second review with NULL tripId for the same (author, target) → P2002 (DB level)", async () => {
    // Arrange — первый отзыв без поездки (tripId IS NULL).
    await createReviewDirect(passengerId, driverId, 4);

    // Act/Assert — второй отзыв той же пары с NULL tripId отклонён БД:
    // partial-индекс нарушается, Prisma отбивает P2002.
    await expect(
      createReviewDirect(passengerId, driverId, 5)
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
      expect(cause?.constraint?.index).toBe(NULL_TRIP_INDEX);
      return true;
    });
  });

  it("rejects ratings outside the 1..5 database constraint", async () => {
    await expect(createReviewDirect(passengerId, driverId, 0)).rejects.toThrow();
    await expect(createReviewDirect(passengerId, driverId, 6)).rejects.toThrow();
  });

  it("NULL-tripId review for a different target is allowed (partial index scope)", async () => {
    const otherTargetId = await createUser("NullTripOtherTarget");

    await createReviewDirect(passengerId, driverId, 4);
    const review = await createReviewDirect(passengerId, otherTargetId, 5);

    expect(review).toBeTruthy();
  });

  it("same (author, target) with different trips is allowed (full index path)", async () => {
    const trip1Id = await createPastTrip(driverId);
    const trip2Id = await createPastTrip(driverId);

    await createReviewDirect(passengerId, driverId, 4, trip1Id);
    const review = await createReviewDirect(passengerId, driverId, 5, trip2Id);

    expect(review).toBeTruthy();
  });

  it("concurrent identical POST /reviews: exactly one 201, loser 409 ALREADY_REVIEWED, never 500", async () => {
    // Arrange — прошедшая поездка, пассажир подтверждённо участвует,
    // target — водитель (все проверки POST /reviews пройдены).
    const tripId = await createPastTrip(driverId);
    await createBooking(tripId, passengerId);

    const post = () =>
      app.request("/api/v1/reviews", {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          Authorization: `Bearer ${devMockAccessToken(passengerId)}`,
        },
        body: JSON.stringify({
          tripId,
          targetUserId: driverId,
          rating: 4,
          text: "Конкурентный отзыв",
        }),
      });

    // Act — два одинаковых запроса одновременно.
    const [r1, r2] = await Promise.all([post(), post()]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);

    // Assert — победитель 201; проигравший 409 ALREADY_REVIEWED
    // (P2002 от unique-индекса или повторная проверка в транзакции —
    // оба пути мапятся в 409). 500 исключён.
    expect(statuses).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    const loserBody = (await loser.json()) as { code: string };
    expect(loserBody.code).toBe("ALREADY_REVIEWED");

    // F14-cleanup: отзыв победителя трекаем для afterEach — иначе он
    // остаётся в БД (trip уже удалён → tripId SetNull) и deleteMany users
    // падает по FK Review_targetUserId_fkey, оставляя stray-строки
    // (ломают auth-concurrent-launch с тем же диапазоном id).
    const winner = r1.status === 201 ? r1 : r2;
    const winnerBody = (await winner.json()) as { id: string };
    createdReviewIds.push(winnerBody.id);

    // В БД ровно один отзыв (дубля нет ни при каком исходе гонки).
    const count = await db.review.count({
      where: { authorId: passengerId, tripId, targetUserId: driverId },
    });
    expect(count).toBe(1);
  });
});
