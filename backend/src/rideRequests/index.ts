import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import {
  createRideRequestDtoSchema,
  rideRequestListQuerySchema,
  rideRequestStatusUpdateSchema,
  updateRideRequestDtoSchema,
} from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { getSanitizedBody, sanitizeValue } from "../middleware/sanitize.js";
import {
  mutationLimiter,
  createUserRateLimiter,
  publicReadLimiter,
} from "../middleware/rateLimit.js";
import { ERROR_CODES } from "../errors.js";
import { devRateMax } from "../env.js";
import { serializeRideRequest } from "./serializers.js";

const MAX_ACTIVE_REQUESTS = 3;
// Потолок ленты главной: секция на экране, 20 строк — уже не список.
const FEED_MAX_LIMIT = 20;
// Пул заявок для агрегации ленты: активных заявок у человека до трёх, поэтому
// 500 активных заявок — заведомо больше ожидаемого спроса.
const FEED_AGGREGATE_POOL = 500;
const rideRequestMutationLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: devRateMax(30),
  keyPrefix: "ride-request-mutation",
});

export const rideRequestsRouter = new Hono<AuthEnv>();
rideRequestsRouter.use("*", requireUser);

const includeCities = { fromCity: true, toCity: true } as const;

async function getOwnedRequest(id: string, userId: string) {
  return db.rideRequest.findFirst({
    where: { id, userId },
    include: includeCities,
  });
}

rideRequestsRouter.get("/", async (c) => {
  const parsed = rideRequestListQuerySchema.safeParse(
    sanitizeValue(c.req.query()),
  );
  if (!parsed.success)
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid query" },
      400,
    );

  const { status, page, limit } = parsed.data;
  const userId = c.get("user").id;
  const where = { userId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    db.rideRequest.findMany({
      where,
      include: includeCities,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.rideRequest.count({ where }),
  ]);
  return c.json({
    items: items.map(serializeRideRequest),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

rideRequestsRouter.post(
  "/",
  mutationLimiter,
  rideRequestMutationLimiter,
  async (c) => {
    const parsed = createRideRequestDtoSchema.safeParse(
      await getSanitizedBody(c),
    );
    if (!parsed.success)
      return c.json(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Invalid payload",
          errors: z.formatError(parsed.error),
        },
        400,
      );
    const userId = c.get("user").id;
    const data = parsed.data;
    const now = new Date();

    let result;
    try {
      result = await db.$transaction(
        async (tx) => {
          const activeCount = await tx.rideRequest.count({
            where: {
              userId,
              status: { in: ["active", "paused"] },
              expiresAt: { gt: now },
            },
          });
          if (activeCount >= MAX_ACTIVE_REQUESTS)
            return { kind: "limit" as const };
          const cities = await tx.city.findMany({
            where: { id: { in: [data.fromCityId, data.toCityId] } },
            select: { id: true },
          });
          if (cities.length !== 2) return { kind: "city" as const };
          return {
            kind: "created" as const,
            item: await tx.rideRequest.create({
              data: {
                ...data,
                userId,
                earliestAt: new Date(data.earliestAt),
                latestAt: new Date(data.latestAt),
                expiresAt: new Date(data.expiresAt),
              },
              include: includeCities,
            }),
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return c.json(
          {
            code: ERROR_CODES.CONFLICT,
            message: "Ride request was just changed",
          },
          409,
        );
      }
      throw error;
    }
    if (result.kind === "limit")
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Too many active ride requests",
        },
        409,
      );
    if (result.kind === "city")
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "City not found" },
        400,
      );
    const item = result.item;
    return c.json(serializeRideRequest(item), 201);
  },
);

rideRequestsRouter.get("/matching", publicReadLimiter, async (c) => {
  const fromCityId = c.req.query("fromCityId");
  const toCityId = c.req.query("toCityId");
  const earliestAt = c.req.query("earliestAt");
  const latestAt = c.req.query("latestAt");
  if (!fromCityId || !toCityId || !earliestAt || !latestAt) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid matching query",
      },
      400,
    );
  }
  if (
    fromCityId.length > 64 ||
    toCityId.length > 64 ||
    earliestAt.length > 64 ||
    latestAt.length > 64
  ) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid matching query",
      },
      400,
    );
  }
  const start = new Date(earliestAt);
  const end = new Date(latestAt);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  )
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid matching window",
      },
      400,
    );
  const items = await db.rideRequest.findMany({
    where: {
      userId: { not: c.get("user").id },
      fromCityId,
      toCityId,
      status: "active",
      expiresAt: { gt: new Date() },
      earliestAt: { lte: end },
      latestAt: { gte: start },
    },
    include: includeCities,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return c.json({ items: items.map(serializeRideRequest) });
});

/**
 * Лента спроса для главной (`/ride-requests/feed`): СУММАРИЗАТОР по маршрутам.
 *
 * Что показывает: одну строку на пару городов, а не по заявке. «Вологда →
 * Череповец: ищут 2 человека · 2 места · ближайшая завтра, 08:00». Список
 * заявок занимал бы десяток строк одного и того же маршрута и не давал бы масштаба
 * спроса, а масштаб — это и есть смысл витрины.
 *
 * Отличие от `/matching`: тот — инструмент водителя под конкретный маршрут и
 * окно, feed — общая лента без фильтров. Заявку создаёт пассажир (он ищет
 * место), поэтому в заголовке «кто ищет попутку», а не «кого ищут попутчиком».
 *
 * `people` (разные люди) и `seats` (сумма мест) — разные числа: человек может
 * просить несколько мест, поэтому «ищут 1 человек» не значит «нужно 1 место».
 * Людей считаем через `Set` по userId: активных заявок у человека до трёх, и
 * две на одном маршруте не должны превращаться в «2 человека».
 *
 * `count(distinct userId)` Prisma `groupBy` не умеет, поэтому агрегация в JS по
 * ограниченному пулу. Пул (FEED_AGGREGATE_POOL) — честная граница: при его
 * превышении числа занижены, то есть «ищут 12 человек» может оказаться «ищут
 * ≥12». Пул велик относительно ожидаемой нагрузки (3 активные заявки на
 * человека), но ограничение задокументировано, а не спрятано.
 *
 * Сортировка — по спросу (`seats desc`), затем по ближайшему окну: маршрут, где
 * просят больше мест, и есть «популярное направление», а дата лишь разводит
 * равные по спросу.
 *
 * Имена не отдаём поштучно: в ответе агрегата нет ни id, ни автора — лента
 * анонимная и не показывает, кто именно ищет попутку.
 */
rideRequestsRouter.get("/feed", publicReadLimiter, async (c) => {
  const rawLimit = c.req.query("limit");
  const parsedLimit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > FEED_MAX_LIMIT
  ) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid limit" },
      400,
    );
  }
  const now = new Date();
  const requests = await db.rideRequest.findMany({
    where: {
      userId: { not: c.get("user").id },
      status: "active",
      expiresAt: { gt: now },
      latestAt: { gt: now },
    },
    select: {
      userId: true,
      fromCityId: true,
      toCityId: true,
      seats: true,
      earliestAt: true,
    },
    orderBy: { earliestAt: "asc" },
    take: FEED_AGGREGATE_POOL,
  });

  type Group = {
    fromCityId: string;
    toCityId: string;
    seats: number;
    nextAt: number;
    people: Set<string>;
  };
  const groups = new Map<string, Group>();
  for (const request of requests) {
    // Обратное направление — отдельная строка: «туда» и «обратно» разные
    // маршруты, и спрос на них не складывается.
    const key = `${request.fromCityId}:${request.toCityId}`;
    const group = groups.get(key);
    if (group) {
      group.people.add(request.userId);
      group.seats += request.seats;
      // Запросы отсортированы по earliestAt, поэтому первый — и есть ближайший.
    } else {
      groups.set(key, {
        fromCityId: request.fromCityId,
        toCityId: request.toCityId,
        seats: request.seats,
        nextAt: request.earliestAt.getTime(),
        people: new Set([request.userId]),
      });
    }
  }

  const ranked = [...groups.values()].sort(
    (a, b) => b.seats - a.seats || a.nextAt - b.nextAt,
  );
  const top = ranked.slice(0, parsedLimit);
  if (top.length === 0) return c.json({ items: [] });

  // Имена городов одним запросом: groupBy/JS-агрегация их не включают.
  const cityIds = [...new Set(top.flatMap((g) => [g.fromCityId, g.toCityId]))];
  const cities = await db.city.findMany({ where: { id: { in: cityIds } } });
  const cityById = new Map(cities.map((city) => [city.id, city]));

  const items = top.flatMap((group) => {
    const from = cityById.get(group.fromCityId);
    const to = cityById.get(group.toCityId);
    // Города нет в справочнике (удалён при смене справочника) — строку без
    // названий показать нечем, выбрасываем, а не показываем id.
    if (!from || !to) return [];
    return [
      {
        fromCity: { id: from.id, name: from.name },
        toCity: { id: to.id, name: to.name },
        people: group.people.size,
        seats: group.seats,
        nextAt: new Date(group.nextAt).toISOString(),
      },
    ];
  });
  return c.json({ items });
});

rideRequestsRouter.patch(
  "/:id",
  mutationLimiter,
  rideRequestMutationLimiter,
  async (c) => {
    const current = await getOwnedRequest(c.req.param("id"), c.get("user").id);
    if (!current)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    if (!["active", "paused"].includes(current.status))
      return c.json(
        { code: ERROR_CODES.CONFLICT, message: "Ride request is terminal" },
        409,
      );
    const parsed = updateRideRequestDtoSchema.safeParse(
      await getSanitizedBody(c),
    );
    if (!parsed.success)
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid payload" },
        400,
      );
    const data = parsed.data;
    const earliestAt = data.earliestAt
      ? new Date(data.earliestAt)
      : current.earliestAt;
    const latestAt = data.latestAt ? new Date(data.latestAt) : current.latestAt;
    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : current.expiresAt;
    if (earliestAt >= latestAt || expiresAt <= new Date())
      return c.json(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Invalid request window",
        },
        400,
      );
    const updated = await db.rideRequest.updateMany({
      where: {
        id: current.id,
        userId: c.get("user").id,
        status: { in: ["active", "paused"] },
      },
      data: {
        ...(data.seats === undefined ? {} : { seats: data.seats }),
        earliestAt,
        latestAt,
        expiresAt,
      },
    });
    if (updated.count !== 1)
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Ride request was just changed",
        },
        409,
      );
    const item = await getOwnedRequest(current.id, c.get("user").id);
    if (!item)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    return c.json(serializeRideRequest(item));
  },
);

rideRequestsRouter.patch(
  "/:id/status",
  mutationLimiter,
  rideRequestMutationLimiter,
  async (c) => {
    const current = await getOwnedRequest(c.req.param("id"), c.get("user").id);
    if (!current)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    const parsed = rideRequestStatusUpdateSchema.safeParse(
      await getSanitizedBody(c),
    );
    if (!parsed.success)
      return c.json(
        { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid payload" },
        400,
      );
    const next = parsed.data.status;
    if (
      !["active", "paused"].includes(current.status) ||
      (next === "active" && current.expiresAt <= new Date())
    )
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Invalid ride request transition",
        },
        409,
      );
    const updated = await db.rideRequest.updateMany({
      where: {
        id: current.id,
        userId: c.get("user").id,
        status: { in: ["active", "paused"] },
      },
      data: { status: next },
    });
    if (updated.count !== 1)
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Ride request was just changed",
        },
        409,
      );
    const item = await getOwnedRequest(current.id, c.get("user").id);
    if (!item)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    return c.json(serializeRideRequest(item));
  },
);

rideRequestsRouter.delete(
  "/:id",
  mutationLimiter,
  rideRequestMutationLimiter,
  async (c) => {
    const current = await getOwnedRequest(c.req.param("id"), c.get("user").id);
    if (!current)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    if (current.status === "cancelled")
      return c.json(serializeRideRequest(current));
    const updated = await db.rideRequest.updateMany({
      where: {
        id: current.id,
        userId: c.get("user").id,
        status: { in: ["active", "paused"] },
      },
      data: { status: "cancelled" },
    });
    if (updated.count !== 1)
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Ride request was just changed",
        },
        409,
      );
    const item = await getOwnedRequest(current.id, c.get("user").id);
    if (!item)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );
    return c.json(serializeRideRequest(item));
  },
);
