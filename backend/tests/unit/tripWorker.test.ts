import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const bookingFindMany = vi.fn().mockResolvedValue([]);
const transaction = vi.fn();

vi.mock("../../src/db.js", () => ({
  db: {
    trip: { findMany },
    booking: { findMany: bookingFindMany },
    $transaction: transaction,
  },
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/logger/business.js", () => ({ logBusinessEvent: vi.fn() }));
vi.mock("../../src/services/notification.service.js", () => ({
  createNotification: vi.fn(),
  notifyUser: vi.fn(),
  pruneOldNotifications: vi.fn(),
  tripSnapshotOf: vi.fn(),
}));
vi.mock("../../src/ws/manager.js", () => ({
  wsManager: { sendToUser: vi.fn() },
}));

const { startTripWorker, stopTripWorker, processExpiredTrips } = await import(
  "../../src/workers/tripWorker.js"
);
const { logger } = await import("../../src/logger.js");
const { Prisma } = await import("../../src/generated/prisma/client.js");

/** Инстанс с нужным prototype, чтобы сработал `instanceof` в prismaErrorCode. */
const prismaError = (code: string): Error =>
  Object.assign(Object.create(Prisma.PrismaClientKnownRequestError.prototype), {
    code,
    message: `Prisma ${code}`,
  }) as Error;

const FAILING_BOOKING_ID = "00000000-0000-4000-8000-00000000f001";
const OK_BOOKING_ID = "00000000-0000-4000-8000-00000000f002";
const FAILING_TRIP_ID = "00000000-0000-4000-8000-00000000e001";
const OK_TRIP_ID = "00000000-0000-4000-8000-00000000e002";

const bookingUpdateMany = vi.fn();
const tripUpdateMany = vi.fn();

/** tx-заглушка: эмулирует claim внутри $transaction, отдавая наружу его ошибку. */
const tx = {
  booking: { updateMany: bookingUpdateMany },
  trip: { updateMany: tripUpdateMany },
};

describe("trip worker cycle error isolation", () => {
  beforeEach(() => {
    findMany.mockResolvedValue([]);
    bookingFindMany.mockResolvedValue([]);
    tripUpdateMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    bookingUpdateMany.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === FAILING_BOOKING_ID) {
        // Write-конфликт сериализации: транзакция откатывается, бронь
        // остаётся pending.
        throw prismaError("P2034");
      }
      return Promise.resolve({ count: 1 });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("сбой одной брони не отменяет остальные брони и остальные шаги цикла", async () => {
    bookingFindMany.mockResolvedValue([
      { id: FAILING_BOOKING_ID, tripId: FAILING_TRIP_ID, passengerId: "p1" },
      { id: OK_BOOKING_ID, tripId: OK_TRIP_ID, passengerId: "p2" },
    ]);

    await processExpiredTrips();

    // Вторая бронь отработана в том же sweep, несмотря на P2034 первой.
    expect(bookingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: OK_BOOKING_ID }) }),
    );
    expect(bookingUpdateMany).toHaveBeenCalledTimes(2);
    // Место освобождено только для успешно обработанной брони.
    expect(tripUpdateMany).toHaveBeenCalledTimes(1);
    expect(tripUpdateMany).toHaveBeenCalledWith({
      where: { id: OK_TRIP_ID, status: "active" },
      data: { seatsAvailable: { increment: 1 } },
    });

    // completeAutoCompleteTrips (opt-in проход) и проход по TTL-просрочке
    // выполнены — раньше P2034 обрывал цикл до обоих.
    const tripPasses = findMany.mock.calls.map(
      ([args]) => (args as { where: { autoComplete: boolean } }).where.autoComplete,
    );
    expect(tripPasses).toEqual([true, false]);

    // Ошибка не съедена молча: id брони и Prisma-код в логе.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: FAILING_BOOKING_ID,
        tripId: FAILING_TRIP_ID,
        code: "P2034",
      }),
      "trip_worker_expire_booking_failed",
    );
    // И сводка по проходу — по ней видно, что sweep был неполным.
    expect(logger.error).toHaveBeenCalledWith(
      { failed: 1 },
      "trip_worker_expire_bookings_partial",
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.anything(),
      "trip_worker_fatal_error",
    );
  });

  it("падение шага expirePendingBookings не отменяет автозавершение и проход по просрочке", async () => {
    bookingFindMany.mockRejectedValue(new Error("pool exhausted"));

    await processExpiredTrips();

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      "trip_worker_expire_bookings_failed",
    );
    const tripPasses = findMany.mock.calls.map(
      ([args]) => (args as { where: { autoComplete: boolean } }).where.autoComplete,
    );
    expect(tripPasses).toEqual([true, false]);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.anything(),
      "trip_worker_fatal_error",
    );
  });

  it("успешный цикл: sweep отклоняет все брони и логирует ту же сводку", async () => {
    bookingFindMany.mockResolvedValue([
      { id: FAILING_BOOKING_ID, tripId: FAILING_TRIP_ID, passengerId: "p1" },
      { id: OK_BOOKING_ID, tripId: OK_TRIP_ID, passengerId: "p2" },
    ]);
    bookingUpdateMany.mockResolvedValue({ count: 1 });

    await processExpiredTrips();

    expect(bookingUpdateMany).toHaveBeenCalledTimes(2);
    expect(tripUpdateMany).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
    const tripPasses = findMany.mock.calls.map(
      ([args]) => (args as { where: { autoComplete: boolean } }).where.autoComplete,
    );
    expect(tripPasses).toEqual([true, false]);
  });
});

describe("trip worker lifecycle", () => {
  /** Прокрутить микротаски, пока цикл не дойдёт до чтения поездок. */
  const flushUntilTripRead = async () => {
    for (let i = 0; i < 20 && findMany.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
  };

  afterEach(() => {
    stopTripWorker();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts one detached interval and skips overlapping cycles", async () => {
    vi.useFakeTimers();
    let finishCycle: (() => void) | undefined;
    findMany.mockImplementation(
      () => new Promise<void>((resolve) => (finishCycle = resolve))
    );

    startTripWorker();
    startTripWorker();

    expect(vi.getTimerCount()).toBe(1);
    // Первые шаги цикла (сброс pending-броней, prune) асинхронны — ждём
    // не фиксированное число тиков, а самого обращения к trip.findMany.
    await flushUntilTripRead();
    expect(findMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(findMany).toHaveBeenCalledTimes(1);

    finishCycle?.();
    await Promise.resolve();
    stopTripWorker();
    expect(vi.getTimerCount()).toBe(0);
  });
});
