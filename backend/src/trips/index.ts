// backend/src/trips/index.ts
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import {
  createTripDtoSchema,
  updateTripDtoSchema,
  ACTIVE_BOOKING_STATUSES,
} from "@edem/contracts";
import { db } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireUser, type AuthUser } from "../auth/middleware.js";
import { optionalAuth } from "../auth/optionalMiddleware.js";
import { serializeTrip } from "../serializers/index.js";
import {
  publicReadLimiter,
  mutationLimiter,
  createTripLimiter,
  cancelTripLimiter,
  completeTripLimiter,
} from "../middleware/rateLimit.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { logBusinessEvent } from "../logger/business.js";
import { createNotification } from "../services/notification.service.js";
import { wsManager } from "../ws/manager.js";
import { notifyMatchingRideRequests } from "../rideRequests/matching.js";
import {
  decrementCityTripsCount,
  incrementCityTripsCount,
} from "../cities/counters.js";
import { TripError, TripErrors } from "./errors.js";
import {
  getTripRange,
  rangesOverlap,
  type TimeRange,
} from "../utils/overlap.js";
import { moscowDateBoundary } from "../utils/moscowTime.js";

type TripWithDriver = Prisma.TripGetPayload<{
  include: { driver: { include: { car: true } } };
}>;

const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE = 10_000;

async function getActiveBookingSeatsByTripIds(
  tripIds: string[],
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();

  if (tripIds.length === 0) {
    return map;
  }

  const bookings = await db.booking.findMany({
    where: {
      tripId: {
        in: tripIds,
      },
      status: {
        in: [...ACTIVE_BOOKING_STATUSES],
      },
    },
    select: {
      tripId: true,
      seat: true,
    },
  });

  for (const booking of bookings) {
    const seats = map.get(booking.tripId) ?? [];
    seats.push(booking.seat);
    map.set(booking.tripId, seats);
  }

  return map;
}

/**
 * Решение 3: новый интервал поездки не должен пересекаться с другими
 * активными бронями (pending/confirmed на active-поездках) пассажиров
 * ЭТОЙ поездки. Семантика один в один как проверка пассажира при
 * создании брони (bookings/index.ts): точная граница пересечением
 * не считается.
 */
async function assertPassengersHaveNoBookingOverlap(
  tx: Prisma.TransactionClient,
  tripId: string,
  newRange: TimeRange,
): Promise<void> {
  const tripActiveBookings = await tx.booking.findMany({
    where: {
      tripId,
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      OR: [
        { status: "confirmed" },
        {
          status: "pending",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      ],
    },
    select: { passengerId: true },
  });

  const passengerIds = Array.from(
    new Set(tripActiveBookings.map((booking) => booking.passengerId)),
  );

  if (passengerIds.length === 0) {
    return;
  }

  const otherActiveBookings = await tx.booking.findMany({
    where: {
      passengerId: { in: passengerIds },
      // Брони на ЭТУ поездку исключаем: сравниваем только с ДРУГИМИ поездками.
      tripId: { not: tripId },
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      OR: [
        { status: "confirmed" },
        {
          status: "pending",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      ],
      trip: {
        status: "active",
        // Потенциально пересекаются только поездки, стартующие до конца
        // нового интервала: остальные гарантированно не пересекаются.
        departureAt: { lt: newRange.end },
      },
    },
    include: {
      trip: { select: { departureAt: true, durationMinutes: true } },
    },
  });

  const hasOverlap = otherActiveBookings.some((booking) =>
    rangesOverlap(
      newRange,
      getTripRange(booking.trip.departureAt, booking.trip.durationMinutes),
    ),
  );

  if (hasOverlap) {
    throw new TripError(
      TripErrors.passengerOverlap(),
      "Новое время пересекается с другими активными бронями пассажиров",
    );
  }
}

export const tripsRouter = new Hono<{ Variables: { user?: AuthUser } }>();

/**
 * Публичный список активных поездок.
 */
tripsRouter.get("/", publicReadLimiter, async (c) => {
  const q = c.req.query("q");
  const fromCity = c.req.query("fromCity");
  const toCity = c.req.query("toCity");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const maxPrice = c.req.query("maxPrice");
  const tagsParam = c.req.query("tags");
  const pageParam = c.req.query("page");
  const limitParam = c.req.query("limit");

  const page = Math.min(
    MAX_PAGE,
    Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1),
  );
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(limitParam ?? "20", 10) || 20),
  );
  const skip = (page - 1) * limit;

  if (
    [q, fromCity, toCity].some(
      (value) => value && value.length > MAX_SEARCH_LENGTH,
    )
  ) {
    return c.json(
      {
        message: `Search parameters must not exceed ${MAX_SEARCH_LENGTH} characters`,
      },
      400,
    );
  }

  if (tagsParam && tagsParam.length > 600) {
    return c.json({ message: "Invalid tags" }, 400);
  }

  const where: Prisma.TripWhereInput = {
    status: "active",
    // Скрываем уже уехавшие поездки: автозавершение воркером происходит
    // только через 24 часа после отправления, без этого фильтра поиск
    // показывал бы рейсы, на которые уже невозможно успеть.
    departureAt: { gt: new Date() },
  };

  if (q) {
    where.OR = [
      { fromCity: { contains: q, mode: "insensitive" } },
      { toCity: { contains: q, mode: "insensitive" } },
      { fromAddress: { contains: q, mode: "insensitive" } },
      { toAddress: { contains: q, mode: "insensitive" } },
    ];
  }

  if (fromCity) {
    where.fromCity = { contains: fromCity, mode: "insensitive" };
  }

  if (toCity) {
    where.toCity = { contains: toCity, mode: "insensitive" };
  }

  if (dateFrom) {
    const parsedDate = moscowDateBoundary(dateFrom);
    if (parsedDate) {
      where.departureAt = {
        ...(where.departureAt as object),
        gte: parsedDate,
      };
    }
  }

  if (dateTo) {
    const parsedDateTo = moscowDateBoundary(dateTo, true);
    if (parsedDateTo) {
      where.departureAt = {
        ...(where.departureAt as object),
        lte: parsedDateTo,
      };
    }
  }

  if (tagsParam) {
    const tags = tagsParam.split(",").filter(Boolean);
    if (tags.length > 6 || tags.some((tag) => tag.length > MAX_SEARCH_LENGTH)) {
      return c.json({ message: "Invalid tags" }, 400);
    }
    if (tags.length > 0) {
      where.tags = { hasEvery: tags };
    }
  }

  if (maxPrice) {
    const parsedMaxPrice = Number.parseInt(maxPrice, 10);

    // Контракт (tripFiltersDtoSchema) требует positive int: ноль и
    // отрицательные значения — невалидный фильтр, а не «пустая выдача».
    if (Number.isNaN(parsedMaxPrice) || parsedMaxPrice < 1) {
      return c.json({ message: "Invalid maxPrice" }, 400);
    }

    where.price = { lte: parsedMaxPrice };
  }

  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where,
      include: {
        driver: {
          include: {
            car: true,
          },
        },
      },
      orderBy: [{ departureAt: "asc" }, { id: "asc" }],
      skip,
      take: limit,
    }),
    db.trip.count({ where }),
  ]);

  const bookedSeatsMap = await getActiveBookingSeatsByTripIds(
    trips.map((trip) => trip.id),
  );

  return c.json({
    items: trips.map((trip) =>
      serializeTrip(trip, {
        bookedSeats: bookedSeatsMap.get(trip.id) ?? [],
        includePlate: false,
        includePrivateDetails: false,
      }),
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

/**
 * Поездки текущего пользователя как водителя.
 * Важно: маршрут должен быть объявлен до /:id.
 */
tripsRouter.get("/my", requireUser, async (c) => {
  const user = c.get("user")!;
  const pageParam = c.req.query("page");
  const limitParam = c.req.query("limit");
  const statusParam = c.req.query("status"); // "active" | "archive"
  const page = Math.min(
    MAX_PAGE,
    Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1),
  );
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(limitParam ?? "20", 10) || 20),
  );
  const skip = (page - 1) * limit;

  // Фильтр по статусу для пагинации на клиенте (вкладки "Активные"/"Архив").
  // "active" — только активные; "archive" — completed + cancelled.
  const statusFilter: Prisma.TripWhereInput["status"] =
    statusParam === "active"
      ? "active"
      : statusParam === "archive"
        ? { in: ["completed", "cancelled"] }
        : undefined;

  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where: {
        driverId: user.id,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: {
        driver: {
          include: {
            car: true,
          },
        },
      },
      orderBy: {
        departureAt: "desc",
      },
      skip,
      take: limit,
    }),
    db.trip.count({
      where: {
        driverId: user.id,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
    }),
  ]);

  const tripIds = trips.map((trip) => trip.id);

  const bookings = await db.booking.findMany({
    where: {
      tripId: {
        in: tripIds,
      },
    },
    select: {
      tripId: true,
      seat: true,
      status: true,
    },
  });

  const bookedSeatsMap = new Map<string, number[]>();
  const pendingCountMap = new Map<string, number>();
  const confirmedCountMap = new Map<string, number>();

  for (const booking of bookings) {
    if (booking.status === "pending") {
      pendingCountMap.set(
        booking.tripId,
        (pendingCountMap.get(booking.tripId) ?? 0) + 1,
      );
    }

    if (booking.status === "confirmed") {
      confirmedCountMap.set(
        booking.tripId,
        (confirmedCountMap.get(booking.tripId) ?? 0) + 1,
      );
    }

    if (booking.status === "pending" || booking.status === "confirmed") {
      const seats = bookedSeatsMap.get(booking.tripId) ?? [];
      seats.push(booking.seat);
      bookedSeatsMap.set(booking.tripId, seats);
    }
  }

  return c.json({
    items: trips.map((trip) =>
      serializeTrip(trip, {
        bookedSeats: bookedSeatsMap.get(trip.id) ?? [],
        pendingRequestsCount: pendingCountMap.get(trip.id) ?? 0,
        confirmedBookingsCount: confirmedCountMap.get(trip.id) ?? 0,
      }),
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

/**
 * Детали поездки.
 * Возвращаем bookedSeats, чтобы фронт мог корректно рисовать SeatScheme.
 */
tripsRouter.get("/:id", publicReadLimiter, optionalAuth, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const trip = await db.trip.findUnique({
    where: { id },
    include: {
      driver: {
        include: {
          car: true,
        },
      },
    },
  });

  if (!trip) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Trip not found" },
      404,
    );
  }

  const activeBookings = await db.booking.findMany({
    where: {
      tripId: trip.id,
      status: {
        in: ["pending", "confirmed"],
      },
    },
    select: {
      seat: true,
    },
  });

  let myBooking: {
    id: string;
    seat: number;
    status: string;
    createdAt: Date;
  } | null = null;

  if (currentUser) {
    const booking = await db.booking.findFirst({
      where: {
        tripId: trip.id,
        passengerId: currentUser.id,
        status: { in: ["pending", "confirmed"] },
      },
      select: {
        id: true,
        seat: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    myBooking = booking;
  }

  // Точные адреса встречи видят только участники поездки:
  // водитель и пользователи с активной бронью (pending/confirmed).
  // Остальным адреса не отдаются вовсе (приватность места встречи).
  const canSeePrivateDetails =
    currentUser?.id === trip.driverId || myBooking !== null;
  // Телефон водителя (F1) — строже адресов: только водитель
  // и ПОДТВЕРЖДЁННЫЙ пассажир. Pending-заявителю номер не светим.
  const canSeeDriverPhone =
    currentUser?.id === trip.driverId || myBooking?.status === "confirmed";

  return c.json(
    serializeTrip(trip, {
      bookedSeats: activeBookings.map((booking) => booking.seat),
      myBooking,
      includePlate: false,
      includePrivateDetails: canSeePrivateDetails,
      includeDriverPhone: canSeeDriverPhone,
      // Приватные детали видят только участники (водитель/активная бронь).
      // Платформенный ID водителя наружу не отдаётся.
    }),
  );
});

/**
 * Создание поездки текущим пользователем.
 */
tripsRouter.post(
  "/",
  requireUser,
  mutationLimiter,
  createTripLimiter,
  async (c) => {
    const body = await getSanitizedBody(c);
    const parseResult = createTripDtoSchema.safeParse(body);

    if (!parseResult.success) {
      return c.json(
        {
          message: "Invalid payload",
          errors: z.formatError(parseResult.error),
        },
        400,
      );
    }

    const dto = parseResult.data;
    const driver = c.get("user")!;

    // Водитель должен иметь автомобиль
    if (!driver.car) {
      return c.json(
        {
          code: ERROR_CODES.NO_CAR,
          message: "You must add a car before creating a trip",
        },
        400,
      );
    }

    // Валидация: поездка не может быть в прошлом
    const departureDate = new Date(dto.departureAt);
    if (departureDate <= new Date()) {
      return c.json(
        {
          code: ERROR_CODES.TRIP_IN_PAST,
          message: "Departure time must be in the future",
        },
        400,
      );
    }

    let created: TripWithDriver;
    try {
      // Проверка пересечения с другими active-поездками водителя и создание —
      // в одной Serializable-транзакции: между проверкой и insert не может
      // пройти параллельная поездка на пересекающееся время (иначе две
      // вкладки создали бы два пересекающихся рейса).
      created = await db.$transaction(
        async (tx) => {
          const newRange = getTripRange(departureDate, dto.durationMinutes);

          const driverActiveTrips = await tx.trip.findMany({
            where: {
              driverId: driver.id,
              status: "active",
              // Потенциально пересекаются только поездки, стартующие до конца
              // новой: остальные гарантированно не пересекаются.
              departureAt: { lt: newRange.end },
            },
            select: { departureAt: true, durationMinutes: true },
          });

          const hasOverlap = driverActiveTrips.some((t) =>
            rangesOverlap(
              newRange,
              getTripRange(t.departureAt, t.durationMinutes),
            ),
          );

          if (hasOverlap) {
            throw new TripError(
              TripErrors.overlap(),
              "У вас уже есть поездка на это время",
            );
          }

          // Справочник городов: fromCityId/toCityId обязательны на уровне
          // DTO. Здесь подтверждаем существование и заполняем снимки
          // fromCity/toCity (UI/поиск/уведомления работают по строкам).
          // Уникальность и trim имён — ответственность справочника
          // (см. cityNameBodySchema). Снимки кладём в той же транзакции,
          // что и поездку: консистентно с ON DELETE SET NULL.
          const [fromCityRow, toCityRow] = await Promise.all([
            tx.city.findUnique({
              where: { id: dto.fromCityId },
              select: { id: true, name: true },
            }),
            tx.city.findUnique({
              where: { id: dto.toCityId },
              select: { id: true, name: true },
            }),
          ]);
          if (!fromCityRow) {
            throw new TripError(
              TripErrors.cityNotFound(),
              "Город отправления не найден в справочнике",
            );
          }
          if (!toCityRow) {
            throw new TripError(
              TripErrors.cityNotFound(),
              "Город назначения не найден в справочнике",
            );
          }

          // Денормализованный счётчик поездок на городе: единая точка
          // изменения — cities/counters.ts (F17). Параллельное
          // создание/отмена поездок в одной tx безопасно: serializable
          // уровень изоляции (см. опции $transaction ниже) сериализует
          // записи по (City.id) на уровне predicate locks.
          await incrementCityTripsCount(tx, fromCityRow.id, toCityRow.id);

          return tx.trip.create({
            data: {
              driverId: driver.id,
              fromCity: fromCityRow.name,
              fromAddress: dto.fromAddress,
              toCity: toCityRow.name,
              toAddress: dto.toAddress,
              fromCityId: fromCityRow.id,
              toCityId: toCityRow.id,
              departureAt: new Date(dto.departureAt),
              durationMinutes: dto.durationMinutes,
              distanceKm: dto.distanceKm,
              price: dto.price,
              seatsTotal: dto.seatsTotal,
              seatsAvailable: dto.seatsTotal,
              tags: dto.tags,
              comment: dto.comment,
            },
            include: {
              driver: {
                include: {
                  car: true,
                },
              },
            },
          });
        },
        { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 },
      );
    } catch (error) {
      if (error instanceof TripError) {
        return c.json(
          { code: error.code, message: error.message },
          error.status as ContentfulStatusCode,
        );
      }
      // Serializable: параллельное создание поездки на пересекающееся время —
      // клиент получает 409 и может повторить запрос.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return c.json(
          {
            code: ERROR_CODES.CONFLICT,
            message: "Поездка только что изменилась, попробуйте ещё раз",
          },
          409,
        );
      }
      throw error;
    }

    logBusinessEvent("trip.created", {
      tripId: created.id,
      driverId: driver.id,
      fromCity: dto.fromCity,
      toCity: dto.toCity,
    });

    void notifyMatchingRideRequests(created).catch((error) => {
      logger.error(
        { err: error, tripId: created.id },
        "ride_request_match_notify_failed",
      );
    });

    return c.json(
      serializeTrip(created, {
        bookedSeats: [],
        pendingRequestsCount: 0,
      }),
      201,
    );
  },
);

tripsRouter.patch("/:id", requireUser, mutationLimiter, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;
  const body = await getSanitizedBody(c);

  const parseResult = updateTripDtoSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { message: "Invalid payload", errors: z.formatError(parseResult.error) },
      400,
    );
  }

  const dto = parseResult.data;

  let result: { previous: TripWithDriver; updated: TripWithDriver };
  try {
    result = await db.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id },
          include: { driver: { include: { car: true } } },
        });

        if (!trip) {
          throw new TripError(TripErrors.notFound(), "Trip not found");
        }
        if (trip.driverId !== user.id) {
          throw new TripError(TripErrors.forbidden(), "Forbidden");
        }
        if (trip.status !== "active") {
          throw new TripError(TripErrors.notActive(), "Trip is not active");
        }
        // Поездка уже уехала — редактирование запрещено (точка невозврата,
        // консистентно с созданием/отменой брони и confirm/decline водителя).
        if (trip.departureAt <= new Date()) {
          throw new TripError(
            TripErrors.departed(),
            "Trip has already departed",
          );
        }

        // Маршрут (fromCity/fromCityId/toCity/toCityId) ЗАБЛОКИРОВАН для
        // изменения: Zod-схема updateTripDtoSchema запрещает эти поля
        // (`.strict()` + `.omit()`). Защита от обмана пассажиров
        // (см. contracts/dto/trip.dto.ts и EditTripModal). Чтобы сменить
        // маршрут, водитель должен отменить поездку и создать новую.
        const updateData: Prisma.TripUpdateInput = {};

        if (
          dto.departureAt !== undefined &&
          new Date(dto.departureAt) <= new Date()
        ) {
          throw new TripError(
            TripErrors.notStarted(),
            "Departure time must be in the future",
          );
        }

        // updateData уже объявлен выше. Маршрут заблокирован
        // (см. комментарий выше).
        if (dto.fromAddress !== undefined)
          updateData.fromAddress = dto.fromAddress;
        if (dto.toAddress !== undefined) updateData.toAddress = dto.toAddress;
        if (dto.departureAt !== undefined)
          updateData.departureAt = new Date(dto.departureAt);
        if (dto.durationMinutes !== undefined)
          updateData.durationMinutes = dto.durationMinutes;
        if (dto.distanceKm !== undefined)
          updateData.distanceKm = dto.distanceKm;
        if (dto.price !== undefined) updateData.price = dto.price;
        if (dto.tags !== undefined) updateData.tags = dto.tags;
        if (dto.comment !== undefined) updateData.comment = dto.comment;

        if (
          dto.departureAt !== undefined ||
          dto.durationMinutes !== undefined
        ) {
          const newDeparture =
            dto.departureAt !== undefined
              ? new Date(dto.departureAt)
              : trip.departureAt;
          const newDuration =
            dto.durationMinutes !== undefined
              ? dto.durationMinutes
              : trip.durationMinutes;
          const newRange = getTripRange(newDeparture, newDuration);

          // Проверяем пересечение с другими active-поездками водителя,
          // исключая текущую (свою же поездку можно «пересекать»).
          const otherActiveTrips = await tx.trip.findMany({
            where: {
              driverId: user.id,
              status: "active",
              id: { not: trip.id },
              departureAt: { lt: newRange.end },
            },
            select: { departureAt: true, durationMinutes: true },
          });

          const hasOverlap = otherActiveTrips.some((t) =>
            rangesOverlap(
              newRange,
              getTripRange(t.departureAt, t.durationMinutes),
            ),
          );

          if (hasOverlap) {
            throw new TripError(
              TripErrors.overlap(),
              "Новое время пересекается с другой вашей поездкой",
            );
          }

          // Проверку броней пассажиров выполняем только если время реально
          // изменилось: no-op обновление не может создать новое пересечение.
          const timeChanged =
            newDeparture.getTime() !== trip.departureAt.getTime() ||
            newDuration !== trip.durationMinutes;

          if (timeChanged) {
            await assertPassengersHaveNoBookingOverlap(tx, trip.id, newRange);
          }
        }

        if (dto.seatsTotal !== undefined) {
          const activeBookingsForSeats = await tx.booking.findMany({
            where: {
              tripId: trip.id,
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              OR: [
                { status: "confirmed" },
                {
                  status: "pending",
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              ],
            },
            select: { seat: true },
          });
          const maxTakenSeat = activeBookingsForSeats.reduce(
            (max, booking) => Math.max(max, booking.seat),
            0,
          );
          if (dto.seatsTotal < activeBookingsForSeats.length) {
            throw new TripError(
              TripErrors.invalidSeats(),
              `Cannot reduce seats below active bookings count (${activeBookingsForSeats.length})`,
            );
          }
          if (dto.seatsTotal < maxTakenSeat) {
            throw new TripError(
              TripErrors.invalidSeats(),
              `Seat #${maxTakenSeat} is occupied — cannot set seatsTotal below ${maxTakenSeat}`,
            );
          }
          updateData.seatsTotal = dto.seatsTotal;
          updateData.seatsAvailable = Math.max(
            0,
            dto.seatsTotal - activeBookingsForSeats.length,
          );
        }

        const updated = await tx.trip.update({
          where: { id },
          data: updateData,
          include: { driver: { include: { car: true } } },
        });

        return { previous: trip, updated };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof TripError) {
      return c.json(
        { code: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    // Serializable: параллельное изменение поездки/брони — клиент
    // получает 409 и может повторить запрос с актуальными данными.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Поездка только что изменилась, попробуйте ещё раз",
        },
        409,
      );
    }
    throw error;
  }

  const { previous: trip, updated } = result;

  /**
   * Если изменились важные для пассажиров поля — уведомляем подтверждённых пассажиров
   * (персистентное уведомление + WS-событие для онлайн-клиентов).
   */
  // Маршрут (fromCity/fromCityId/toCity/toCityId) locked на уровне
  // updateTripDtoSchema.omit(...).strict(): PATCH /trips/:id не может менять
  // маршрут, поэтому проверки `dto.fromCity`/`dto.toCity` здесь излишни —
  // поле просто не придёт. Эти ветки были мёртвым кодом после d4f722f.
  const importantFieldsChanged =
    (dto.departureAt !== undefined &&
      trip.departureAt.toISOString() !== updated.departureAt.toISOString()) ||
    (dto.fromAddress !== undefined &&
      trip.fromAddress !== updated.fromAddress) ||
    (dto.toAddress !== undefined && trip.toAddress !== updated.toAddress) ||
    (dto.price !== undefined && trip.price !== updated.price);

  if (importantFieldsChanged) {
    const confirmedBookings = await db.booking.findMany({
      where: { tripId: trip.id, status: "confirmed" },
      select: { passengerId: true },
    });

    // createNotification глотает ошибки внутри, поэтому параллелим безопасно.
    await Promise.all(
      confirmedBookings.map(async (booking) => {
        await createNotification(
          booking.passengerId,
          "trip_details_changed",
          "Детали поездки изменены",
          `Водитель изменил детали поездки ${updated.fromCity} → ${updated.toCity}. Проверьте время и место встречи.`,
        );

        wsManager.sendToUser(booking.passengerId, {
          type: "trip:details_changed",
          payload: { tripId: trip.id },
        });
        // Подсказываем онлайн-клиенту обновить список/счётчик уведомлений.
        wsManager.sendToUser(booking.passengerId, {
          type: "notification:new",
          payload: { id: "refresh" },
        });
      }),
    );
  }

  return c.json(serializeTrip(updated));
});

/**
 * Отмена поездки водителем.
 *
 * Логика:
 * - отменить может только водитель поездки;
 * - отменить можно только active поездку;
 * - все pending/confirmed брони становятся cancelled;
 * - seatsAvailable обнуляется, так как поездка больше не доступна для бронирования.
 *
 * TOCTOU: загрузка поездки и все проверки выполняются ВНУТРИ Serializable-
 * транзакции. Между чтением статуса и записью не может пройти параллельная
 * отмена/завершение (воркером или вторым запросом): конфликтная транзакция
 * получит P2034 и ответит 409, а не перезапишет статус.
 */
tripsRouter.patch("/:id/cancel", requireUser, cancelTripLimiter, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;

  let result: { updated: TripWithDriver; uniquePassengers: string[] };
  try {
    result = await db.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id },
          include: {
            driver: {
              include: {
                car: true,
              },
            },
          },
        });

        if (!trip) {
          throw new TripError(TripErrors.notFound(), "Trip not found");
        }
        if (trip.driverId !== user.id) {
          throw new TripError(TripErrors.forbidden(), "Forbidden");
        }
        if (trip.status !== "active") {
          throw new TripError(TripErrors.notActive(), "Trip is not active");
        }

        // Пассажиров собираем ДО updateMany: после перевода броней в cancelled
        // выборка по pending/confirmed вернёт пустой массив.
        const activeBookings = await tx.booking.findMany({
          where: { tripId: trip.id, status: { in: ["pending", "confirmed"] } },
          select: { passengerId: true },
        });

        await tx.booking.updateMany({
          where: {
            tripId: trip.id,
            status: {
              in: ["pending", "confirmed"],
            },
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledByType: "user",
            cancelledByUserId: user.id,
            cancellationReason: "Trip cancelled by driver",
          },
        });

        const updated = await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: "cancelled",
            seatsAvailable: 0,
            cancelledAt: new Date(),
            cancelledByType: "user",
            cancelledByUserId: user.id,
            cancellationReason: "Trip cancelled by driver",
          },
          include: {
            driver: {
              include: {
                car: true,
              },
            },
          },
        });

        // F17: отмена поездки декрементирует счётчики городов — в той же
        // транзакции, что и смена статуса, чтобы счётчик не расходился
        // со статусом. Декремент guarded (tripsCount > 0): счётчик не
        // уходит в минус ни при гонках, ни на дрейфованных данных.
        await decrementCityTripsCount(tx, trip.fromCityId, trip.toCityId);

        return {
          updated,
          uniquePassengers: Array.from(
            new Set(activeBookings.map((b) => b.passengerId)),
          ),
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof TripError) {
      return c.json(
        { code: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    // Serializable: параллельное изменение поездки/брони — клиент
    // получает 409 и может повторить запрос с актуальными данными.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Поездка только что изменилась, попробуйте ещё раз",
        },
        409,
      );
    }
    throw error;
  }

  const { updated, uniquePassengers } = result;

  // createNotification глотает ошибки внутри, поэтому параллелим безопасно.
  await Promise.all(
    uniquePassengers.map(async (pid) => {
      await createNotification(
        pid,
        "trip_cancelled",
        "Поездка отменена",
        `Водитель отменил поездку ${updated.fromCity} → ${updated.toCity}`,
        // Deep-link: тап по push открывает «Мои брони».
        "/bookings",
      );

      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: updated.id, status: "cancelled" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }),
  );

  logBusinessEvent("trip.cancelled", {
    tripId: updated.id,
    driverId: user.id,
  });

  return c.json(
    serializeTrip(updated, {
      bookedSeats: [],
      pendingRequestsCount: 0,
    }),
  );
});

/**
 * Завершение поездки водителем.
 *
 * Правила:
 * - завершить может только водитель поездки;
 * - поездка должна быть active;
 * - по умолчанию завершить можно только поездку, которая уже началась;
 * - force=1 позволяет завершить поездку раньше (полезно для dev/тестирования);
 * - pending-заявки отклоняются;
 * - confirmed-заявки остаются как история.
 *
 * TOCTOU: загрузка поездки и все проверки выполняются ВНУТРИ Serializable-
 * транзакции — параллельные cancel/complete/автозавершение воркером не могут
 * перезаписать статус «из-под» нас (P2034 → 409, tripsCount начисляется ровно
 * один раз).
 */
tripsRouter.patch(
  "/:id/complete",
  requireUser,
  completeTripLimiter,
  async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;
    // force=1 доступен ТОЛЬКО в development/test. В production игнорируем
    // параметр — иначе любой водитель мог бы накручивать tripsCount,
    // завершая поездки до времени отправления.
    const force = !env.isProduction && c.req.query("force") === "1";

    let result: {
      updated: TripWithDriver;
      passengerIds: string[];
      declinedPassengerIds: string[];
    };
    try {
      result = await db.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUnique({
            where: { id },
            include: {
              driver: {
                include: {
                  car: true,
                },
              },
            },
          });

          if (!trip) {
            throw new TripError(TripErrors.notFound(), "Trip not found");
          }
          if (trip.driverId !== user.id) {
            throw new TripError(TripErrors.forbidden(), "Forbidden");
          }
          if (trip.status !== "active") {
            throw new TripError(TripErrors.notActive(), "Trip is not active");
          }
          if (!force && trip.departureAt > new Date()) {
            throw new TripError(
              TripErrors.notStarted(),
              "Trip has not started yet",
            );
          }

          // 1. Decline all pending bookings.
          // Пассажиров собираем ДО updateMany: после перевода заявок в declined
          // выборка по pending вернёт пустой массив (паттерн из tripWorker.ts).
          const pendingBookings = await tx.booking.findMany({
            where: {
              tripId: trip.id,
              status: "pending",
            },
            select: {
              passengerId: true,
            },
          });

          await tx.booking.updateMany({
            where: {
              tripId: trip.id,
              status: "pending",
            },
            data: {
              status: "declined",
              cancelledAt: new Date(),
              cancelledByType: "system",
              cancellationReason: "Trip completed",
            },
          });

          const declinedPassengerIds = Array.from(
            new Set(pendingBookings.map((booking) => booking.passengerId)),
          );

          // 2. Find confirmed passengers
          const confirmedBookings = await tx.booking.findMany({
            where: {
              tripId: trip.id,
              status: "confirmed",
            },
            select: {
              passengerId: true,
            },
          });

          const passengerIds = Array.from(
            new Set(confirmedBookings.map((booking) => booking.passengerId)),
          );

          // 3. Driver +1 tripsCount
          await tx.user.update({
            where: { id: trip.driverId },
            data: {
              tripsCount: {
                increment: 1,
              },
            },
          });

          // 4. Each confirmed passenger +1 tripsCount
          for (const passengerId of passengerIds) {
            await tx.user.update({
              where: { id: passengerId },
              data: {
                tripsCount: {
                  increment: 1,
                },
              },
            });
          }

          // 5. Update trip status
          const updated = await tx.trip.update({
            where: { id: trip.id },
            data: {
              status: "completed",
              seatsAvailable: 0,
            },
            include: {
              driver: {
                include: {
                  car: true,
                },
              },
            },
          });

          return { updated, passengerIds, declinedPassengerIds };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof TripError) {
        return c.json(
          { code: error.code, message: error.message },
          error.status as ContentfulStatusCode,
        );
      }
      // Serializable: параллельное завершение той же поездки — одна из
      // транзакций не сможет подтвердиться (write conflict). Возвращаем
      // 409 вместо 500: tripsCount при этом начислен ровно один раз.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return c.json(
          {
            code: ERROR_CODES.CONFLICT,
            message: "Поездка только что изменилась, попробуйте ещё раз",
          },
          409,
        );
      }
      throw error;
    }

    const { updated, passengerIds, declinedPassengerIds } = result;

    logBusinessEvent("trip.completed", {
      tripId: updated.id,
      driverId: user.id,
      passengersCount: passengerIds.length,
    });

    // Персистентные уведомления + WS-события пассажирам (ВНЕ транзакции,
    // паттерн как в автозавершении воркером).
    for (const pid of passengerIds) {
      await createNotification(
        pid,
        "trip_status_changed",
        "Поездка завершена",
        `Поездка ${updated.fromCity} → ${updated.toCity} завершена. Вы можете оставить отзыв.`,
        // Deep-link: тап по push открывает историю (где оставляется отзыв).
        "/bookings/history",
      );
      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: updated.id, status: "completed" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }

    // Pending-пассажиры, отклонённые при завершении: уведомляем их так же,
    // как это делает воркер автозавершения (tripWorker.ts), иначе заявка
    // исчезала бы молча.
    for (const pid of declinedPassengerIds) {
      await createNotification(
        pid,
        "trip_status_changed",
        "Поездка завершена",
        `Поездка ${updated.fromCity} → ${updated.toCity} завершена, ваша заявка отклонена.`,
        // Deep-link: тап по push открывает историю броней.
        "/bookings/history",
      );
      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: updated.id, status: "completed" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }

    return c.json(
      serializeTrip(updated, {
        bookedSeats: [],
        pendingRequestsCount: 0,
      }),
    );
  },
);
