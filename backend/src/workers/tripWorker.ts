import { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { logger } from "../logger.js";
import { wsManager } from "../ws/manager.js";
import { logBusinessEvent } from "../logger/business.js";
import {
  notifyUser,
  pruneOldNotifications,
  tripSnapshotOf,
} from "../services/notification.service.js";
import { PENDING_BOOKING_TTL_MS } from "../bookings/shared.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TRIP_WORKER_BATCH_SIZE = 100;

interface ExpiredTrip {
  id: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  price: number;
  departureAt: Date;
  /**
   * Нужен проходу opt-in: Prisma не умеет считать `departureAt +
   * durationMinutes` в where, поэтому «рейс закончился» вычисляется в
   * памяти. В дефолтном проходе не используется, но грузится вместе с
   * остальным — один select на оба прохода вместо двух.
   */
  durationMinutes: number;
}

/**
 * Каким правилом воркер вправе завершить поездку.
 *
 * Два режима, и путать их опасно:
 * - `autoComplete: false` (дефолт) — поездка «протухает» через
 *   `PENDING_BOOKING_TTL_MS` после отправления. Текущее поведение.
 * - `autoComplete: true` — поездка завершается сразу по окончании рейса,
 *   то есть владелец в форме выбрал «после прибытия, а не через сутки».
 *
 * Предикат claim'а внутри транзакции ОБЯЗАН совпадать с правилом прохода.
 * Общий cutoff для обоих дал бы TOCTOU: opt-in поездка, рейс которой ещё не
 * кончился, завершилась бы по TTL-правилу, а воркер решил бы, что всё по
 * плану.
 */
interface ExpiryClaim {
  /** Правило прохода: по флагу owner-решения. */
  autoComplete: boolean;
  /**
   * Граница для `departureAt`. Для дефолтного прохода — `now − TTL`,
   * для opt-in — `now` (окончание рейса дожимается в памяти, см. проход).
   */
  departureBefore: Date;
}

/**
 * Воркер только АВТО-ЗАВЕРШАЕТ просроченные active-поездки.
 *
 * Отменённые поездки НИКОГДА не удаляем физически: CASCADE в схеме стёр бы
 * связанные брони и отзывы, и у пассажиров пропала бы история поездок
 * (экран «История»). Отменённые поездки не попадают в поиск (фильтр
 * status: "active") и не мешают работе — пусть лежат в БД.
 *
 * Память: вместо include bookings грузим только ключевые поля поездок
 * пачками (keyset pagination по id), а брони перечитываем точечно внутри
 * транзакции каждой поездки.
 */
export async function processExpiredTrips() {
  const cutoff = new Date(Date.now() - PENDING_BOOKING_TTL_MS);
  let processedCount = 0;
  let lastId: string | null = null;

  try {
    await expirePendingBookings(new Date());
    // Retention-чистка уведомлений — часть часового цикла, отдельного
    // воркера нет. Изолированный try/catch: сбой prune не должен
    // останавливать автозавершение поездок. Счётчики логирует сам хелпер.
    try {
      await pruneOldNotifications(new Date());
    } catch (err) {
      logger.error({ err }, "trip_worker_prune_failed");
    }
    // Проход 1: владелец выбрал «завершать по окончании рейса».
    processedCount += await completeAutoCompleteTrips();
    while (true) {
      const expiredTrips: ExpiredTrip[] = await db.trip.findMany({
        where: {
          status: "active",
          // opt-in поездки сюда НЕ попадают — это экономия прохода, а не
          // единственная защита: настоящую гарантию даёт предикат claim'а
          // (`autoComplete: claim.autoComplete`). Если бы этот фильтр убрали,
          // поездки длиннее суток всё равно не завершились бы раньше конца
          // рейса, но дефолтный проход перебирал бы их каждый час, пока они
          // active. Обе строки нужны, и по разным причинам.
          autoComplete: false,
          departureAt: { lt: cutoff },
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        // select вместо include — брони не грузим здесь, только ключ и данные для уведомлений
        select: {
          id: true,
          driverId: true,
          fromCity: true,
          toCity: true,
          price: true,
          departureAt: true,
          durationMinutes: true,
        },
        orderBy: { id: "asc" },
        take: TRIP_WORKER_BATCH_SIZE,
      });

      if (expiredTrips.length === 0) break;

      logger.info(
        { firstBatchSize: expiredTrips.length, cutoff },
        "trip_worker_found_expired",
      );

      for (const trip of expiredTrips) {
        await processExpiredTrip(trip, {
          autoComplete: false,
          departureBefore: cutoff,
        });
        processedCount++;
      }

      if (expiredTrips.length < TRIP_WORKER_BATCH_SIZE) break;
      lastId = expiredTrips[expiredTrips.length - 1].id;
    }

    if (processedCount > 0) {
      logger.info({ processedCount }, "trip_worker_batch_complete");
    }
  } catch (err) {
    logger.error({ err }, "trip_worker_fatal_error");
  }
}

async function expirePendingBookings(now: Date): Promise<void> {
  // Полный часовой sweep: дренируем все просроченные pending пачками.
  // orderBy детерминирует порядок выборки между итерациями; вышедшие из
  // выборки (declined) строки повторно не читаются — цикл завершается,
  // когда пачка неполная.
  while (true) {
    const expired = await db.booking.findMany({
      where: { status: "pending", expiresAt: { lte: now } },
      select: { id: true, tripId: true, passengerId: true },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: TRIP_WORKER_BATCH_SIZE,
    });
    if (expired.length === 0) break;
    for (const booking of expired) {
      await db.$transaction(
        async (tx) => {
          const claimed = await tx.booking.updateMany({
            where: {
              id: booking.id,
              status: "pending",
              expiresAt: { lte: now },
            },
            data: {
              status: "declined",
              cancelledAt: now,
              cancelledByType: "system",
              cancellationReason: "Booking request expired",
            },
          });
          if (claimed.count === 1) {
            await tx.trip.updateMany({
              where: { id: booking.tripId, status: "active" },
              data: { seatsAvailable: { increment: 1 } },
            });
          }
        },
        { isolationLevel: "Serializable" },
      );
    }
    if (expired.length < TRIP_WORKER_BATCH_SIZE) break;
  }
}

/**
 * Проход для поездок с `autoComplete = true`: завершаются по окончании рейса,
 * а не через TTL.
 *
 * Почему отдельный проход, а не расширение выборки дефолтного: Prisma не
 * умеет сравнивать `departureAt + durationMinutes` с `now`, поэтому «рейс
 * закончился» в `where` не выразить. Сырой SQL ради одного предиката означал
 * бы отказ от Prisma в воркере — несоразмерно. Поэтому кандидаты берутся
 * УЗКО (`status = active`, `autoComplete = true`, отправление уже прошло), а
 * остаток окна добирается в памяти. Асимметрия тут безопасная: лишняя
 * фильтрация в JS стоит ничего, а пропуск поездки означал бы «висит active».
 *
 * Честное ограничение точности: `CHECK_INTERVAL_MS` = час, поэтому «сразу по
 * окончании рейса» на практике = «не позже чем через час после конца рейса».
 * Интервал не меняем: он же сбрасывает pending-брони и чистит уведомления.
 */
async function completeAutoCompleteTrips(): Promise<number> {
  const now = new Date();
  let processed = 0;
  let lastId: string | null = null;

  while (true) {
    const candidates: ExpiredTrip[] = await db.trip.findMany({
      where: {
        status: "active",
        autoComplete: true,
        departureAt: { lt: now },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      select: {
        id: true,
        driverId: true,
        fromCity: true,
        toCity: true,
        price: true,
        departureAt: true,
        durationMinutes: true,
      },
      orderBy: { id: "asc" },
      take: TRIP_WORKER_BATCH_SIZE,
    });

    if (candidates.length === 0) break;

    for (const trip of candidates) {
      const rideEnd = new Date(
        trip.departureAt.getTime() + trip.durationMinutes * 60_000,
      );
      // Рейс ещё идёт — ждём следующего часового тика.
      if (rideEnd > now) continue;
      await processExpiredTrip(trip, {
        autoComplete: true,
        departureBefore: now,
      });
      processed++;
    }

    if (candidates.length < TRIP_WORKER_BATCH_SIZE) break;
    lastId = candidates[candidates.length - 1].id;
  }

  if (processed > 0) {
    logger.info({ processed }, "trip_worker_auto_complete_done");
  }
  return processed;
}

async function processExpiredTrip(trip: ExpiredTrip, claim: ExpiryClaim) {
  try {
    // Транзакция — только изменение данных (без уведомлений, чтобы
    // не держать соединение из пула открытым дольше необходимого).
    const { processed, confirmedPassengerIds, declinedPassengerIds } =
      await db.$transaction(
        async (tx) => {
          const claimed = await tx.trip.updateMany({
            where: {
              id: trip.id,
              status: "active",
              // Правило СВОЕГО прохода, а не общий cutoff: общий дал бы
              // TOCTOU — opt-in поездка, рейс которой ещё идёт, завершилась
              // бы по TTL-отсечке, и воркер счёл бы это плановым закрытием.
              autoComplete: claim.autoComplete,
              departureAt: { lt: claim.departureBefore },
            },
            data: { status: "completed", seatsAvailable: 0 },
          });

          if (claimed.count !== 1) {
            return {
              processed: false,
              confirmedPassengerIds: [] as string[],
              declinedPassengerIds: [] as string[],
            };
          }

          // Перечитываем брони ВНУТРИ транзакции: в batch-запросе
          // processExpiredTrips брони не грузятся, а бронь, созданная в
          // промежутке, иначе осталась бы в статусе pending на завершённой
          // поездке навсегда. Грузим только нужные поля.
          const txBookings = await tx.booking.findMany({
            where: { tripId: trip.id },
            select: { id: true, status: true, passengerId: true },
          });

          const pendingBookingIds = txBookings
            .filter((b) => b.status === "pending")
            .map((b) => b.id);

          if (pendingBookingIds.length > 0) {
            await tx.booking.updateMany({
              where: { id: { in: pendingBookingIds } },
              data: {
                status: "declined",
                cancelledAt: new Date(),
                cancelledByType: "system",
                cancellationReason: "Trip completed",
              },
            });
          }

          await tx.user.update({
            where: { id: trip.driverId },
            data: { tripsCount: { increment: 1 } },
          });

          const confirmedPassengerIds = [
            ...new Set(
              txBookings
                .filter((b) => b.status === "confirmed")
                .map((b) => b.passengerId),
            ),
          ];

          // Один батч-апдейт вместо N отдельных user.update — меньше
          // round-trip'ов и памяти на поездках с большим числом пассажиров.
          if (confirmedPassengerIds.length > 0) {
            await tx.$executeRaw`
            UPDATE "User" SET "tripsCount" = "tripsCount" + 1
            WHERE id IN (${Prisma.join(confirmedPassengerIds)})
          `;
          }

          const declinedPassengerIds = [
            ...new Set(
              txBookings
                .filter((b) => b.status === "pending")
                .map((b) => b.passengerId),
            ),
          ];

          return {
            processed: true,
            confirmedPassengerIds,
            declinedPassengerIds,
          };
        },
        { isolationLevel: "Serializable" },
      );

    if (!processed) {
      return;
    }

    logBusinessEvent("trip.completed", {
      tripId: trip.id,
      driverId: trip.driverId,
      passengersCount: confirmedPassengerIds.length,
    });

    // Уведомления и WS — ВНЕ транзакции (паттерн как в ручном
    // завершении/отмене): персистентные записи + события онлайн-клиентам.
    // Promise.allSettled: отказ одного уведомления не пропускает остальные,
    // необработанных rejections не остаётся.
    // Имя водителя для второй строки ячеек — один запрос на поездку.
    const driver = await db.user.findUnique({
      where: { id: trip.driverId },
      select: { name: true },
    });
    const sideEffects: Array<Promise<unknown> | number> = [
      ...confirmedPassengerIds.flatMap((pId) => [
        (async () => {
          await notifyUser({
            userId: pId,
            type: "trip_status_changed",
            title: "Поездка завершена",
            body: `Поездка ${trip.fromCity} → ${trip.toCity} завершена. Вы можете оставить отзыв.`,
            // Тап открывает шторку деталей завершённой поездки.
            fragment: `/trips/${trip.id}`,
            // Вторая строка — «имя • действие», третья — снапшот поездки.
            actorName: driver?.name,
            action: "completed",
            tripSnapshot: tripSnapshotOf(trip),
            // Получатели — пассажиры автозавершённой поездки.
            role: "passenger",
          });
          wsManager.sendToUser(pId, {
            type: "trip:status_changed",
            payload: { tripId: trip.id, status: "completed" },
          });
        })(),
      ]),
      ...declinedPassengerIds.flatMap((pId) => [
        (async () => {
          await notifyUser({
            userId: pId,
            type: "trip_status_changed",
            title: "Поездка завершена",
            body: `Поездка ${trip.fromCity} → ${trip.toCity} завершена, ваша заявка отклонена.`,
            // Тап открывает шторку деталей завершённой поездки.
            fragment: `/trips/${trip.id}`,
            // Вторая строка — «имя • действие», третья — снапшот поездки.
            actorName: driver?.name,
            action: "completed",
            tripSnapshot: tripSnapshotOf(trip),
            // Получатели — пассажиры с отклонённой pending-заявкой.
            role: "passenger",
          });
          wsManager.sendToUser(pId, {
            type: "trip:status_changed",
            payload: { tripId: trip.id, status: "completed" },
          });
        })(),
      ]),
      // Водителя тоже уведомляем о завершении.
      (async () => {
        await notifyUser({
          userId: trip.driverId,
          type: "trip_status_changed",
          title: "Поездка завершена",
          body: `Ваша поездка ${trip.fromCity} → ${trip.toCity} автоматически завершена.`,
          // Тап открывает шторку деталей завершённой поездки.
          fragment: `/trips/${trip.id}`,
          // Вторая строка — «имя • действие», третья — снапшот поездки.
          actorName: driver?.name,
          action: "completed",
          tripSnapshot: tripSnapshotOf(trip),
          // Получатель — водитель автозавершённой поездки.
          role: "driver",
        });
        wsManager.sendToUser(trip.driverId, {
          type: "trip:status_changed",
          payload: { tripId: trip.id, status: "completed" },
        });
      })(),
    ];

    const results = await Promise.allSettled(sideEffects);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error(
          { tripId: trip.id, err: result.reason },
          "trip_worker_notify_failed",
        );
      }
    }
  } catch (err) {
    logger.error({ err, tripId: trip.id }, "trip_worker_trip_failed");
  }
}

let workerInterval: NodeJS.Timeout | null = null;
let workerRun: Promise<void> | null = null;

function runTripWorkerCycle(): void {
  if (workerRun) return;

  workerRun = processExpiredTrips().finally(() => {
    workerRun = null;
  });
}

export function startTripWorker() {
  if (workerInterval) return;

  // Run once on startup
  runTripWorkerCycle();

  workerInterval = setInterval(() => {
    runTripWorkerCycle();
  }, CHECK_INTERVAL_MS);
  workerInterval.unref?.();

  logger.info("Trip auto-completion worker started");
}

export function stopTripWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Trip auto-completion worker stopped");
  }
}
