import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import {
  DRIVER_INVITE_NOTIFICATION_TYPE,
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
import {
  matchingRideRequestWhere,
  withRoute,
  type TripWithRoute,
} from "./matching.js";
import {
  notifyUser,
  tripSnapshotOf,
} from "../services/notification.service.js";
import { wsManager } from "../ws/manager.js";
import { logBusinessEvent } from "../logger/business.js";

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
    // Хинт водителям по подходящим поездкам — наружу и неблокирующе: ответ
    // клиенту не должен ждать рассылку, а wsManager.sendToUser синхронный и
    // не бросает (упавший сокет закрывается внутри). Ошибка БД здесь — тоже
    // не причина отдавать 500 на успешно созданной заявке, поэтому catch.
    void notifyTripsAboutNewRequest(item).catch((error) => {
      logBusinessEvent("ride_request.demand_hint_failed", {
        requestId: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return c.json(serializeRideRequest(item), 201);
  },
);

/**
 * Хинт водителям: «появился попутчик под ваш маршрут» (слой 1a в реальном
 * времени).
 *
 * Обратная сторона пересечения заявки и поездки. Уведомление при СОЗДАНИИ
 * поездки (`notifyMatchingRideRequests`) шлёт пассажиру, когда появляется машина;
 * обратного сигнала не было, и водитель о новом попутчике узнавал только по
 * `staleTime` карточки спроса (30с) — при выключенном `refetchOnWindowFocus`
 * это до полуминуты stale на активном экране.
 *
 * Кому: водителям активных поездок, чей маршрут совпадает по справочнику и чьё
 * окно пересекается с окном заявки. Условие — ОБРАТНАЯ сторона
 * `matchingRideRequestWhere`: там заявка подбирается под поездку, здесь
 * поездка под заявку. Формулы симметричны (окна пересекаются), но писать её
 * копией нельзя — при разъезде водителю придёт подсказка, которой он не ждал,
 * а под реальное окно заявка не попадёт.
 *
 * Почему отдельная функция, а не переиспользование предиката: у предиката
 * другая сторона «кроме-кого» (не водитель, а не автор), и подставлять его
 * наоборот нельзя — это молча исключило бы самого автора заявки.
 *
 * Порядок — один проход по активным поездкам маршрута, лимит и дедуп на
 * уровне водителя: у человека несколько поездок одного маршрута, а хинт о
 * спросе ему один (карточка спроса живёт по каждой поездке, но клиент
 * инвалидирует ключ по `tripId`, поэтому дубли по поездкам НЕ лишние — они
 * адресны). Адресат — один: `trip.driverId`.
 */
async function notifyTripsAboutNewRequest(
  request: Awaited<ReturnType<typeof getOwnedRequest>>,
): Promise<void> {
  if (!request) return;
  // Старые поездки без FK на справочник подбирать нечем (см. withRoute).
  if (!request.fromCityId || !request.toCityId) return;

  const now = new Date();
  const trips = await db.trip.findMany({
    where: {
      // Свой спрос автору не показываем: он и так знает, что едет без машины.
      driverId: { not: request.userId },
      fromCityId: request.fromCityId,
      toCityId: request.toCityId,
      status: "active",
      // Поездка уехала — спрос на неё неактуален.
      departureAt: { gt: now },
    },
    select: { id: true, driverId: true, departureAt: true, durationMinutes: true },
    // Экран поездок, а не выгрузка: граница задокументирована.
    take: 50,
  });

  // Окна должны пересекаться — те же границы, что у matchingRideRequestWhere:
  // заявка начинается не позже конца поездки и кончается не раньше её начала.
  const matching = trips.filter(
    (trip) =>
      request.earliestAt <=
        new Date(trip.departureAt.getTime() + trip.durationMinutes * 60_000) &&
      request.latestAt >= trip.departureAt,
  );

  for (const trip of matching) {
    // Hint, а не уведомление в инбоксе: карточка спроса на странице поездки
    // покажет и состав, и окно. WS-событие не создаёт записи в notifications,
    // поэтому тумблер уведомлений его не касается.
    wsManager.sendToUser(trip.driverId, {
      type: "ride_request:new",
      payload: { tripId: trip.id },
    });
  }

  if (matching.length > 0) {
    logBusinessEvent("ride_request.demand_hinted", {
      requestId: request.id,
      trips: matching.length,
    });
  }
}

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

// ─── Приглашение пассажира в поездку водителя ───────────────────────────────
//
// Контур замкнут на уведомлении: водитель зовёт конкретного пассажира, тот
// получает `driver_invite` с deep-link на карточку поездки и бронирует САМ
// (`POST /bookings`). Бронь здесь не создаётся намеренно — решение владельца
// продукта, поэтому ни `Booking.source`, ни `invitedById` не понадобились.

/**
 * Тело приглашения — только поездка, к которой водитель зовёт.
 *
 * Локальная схема вместо DTO в `@edem/contracts`: контракт приглашения
 * (тип уведомления) закрыт в контрактах, а форма запроса — одна строка.
 * Как только появится клиентский вызов, ей место в `dto/ride-request.dto.ts`
 * рядом с остальными DTO заявок, а здесь останется только импорт.
 */
const inviteRideRequestBodySchema = z
  .object({
    // Не uuid(): id приезжает из маршрута, лишняя строгая проверка отвергла бы
    // тест-данные, а не реальные поездки. Наличие поездки проверяет БД.
    tripId: z.string().trim().min(1),
  })
  .strict();

/**
 * Структурированный маркер пары (заявка, поездка) в теле приглашения.
 *
 * Константа — по той же причине, что `MATCH_NOTIFY_TRIP_ID_MARKER`: и текст
 * уведомления, и dedup-запрос строятся из неё, поэтому разойтись они не могут.
 *
 * Ключ ИМЕЕТ БЫТЬ ПАРОЙ, а не одним id поездки: у человека бывает до трёх
 * активных заявок, в том числе несколько на один маршрут, и приглашать его
 * надобно по каждой конкретной — иначе второе приглашение молча подавилось бы
 * как дубль первого. Разделители литеральные, id фиксированной длины, поэтому
 * `contains` инъективен: ключ одной пары не может оказаться подстрокой ключа
 * другой (в отличие от `…<tripId>:<requestId>` без закрывающего `]`).
 */
const INVITE_NOTIFY_PAIR_PREFIX = "[request:";

/** Ключ пары «заявка + поездка» для тела уведомления и для dedup-запроса. */
function invitePairKey(requestId: string, tripId: string): string {
  return `${INVITE_NOTIFY_PAIR_PREFIX}${requestId};trip:${tripId}]`;
}

/** Минимум полей поездки для приглашения: id (deep-link) плюс снимок ячейки. */
type TripForInvite = Parameters<typeof tripSnapshotOf>[0] & { id: string };

/**
 * Заявка, которую водитель вправе позвать: она существует, активна, не
 * просрочена, не от самого водителя и её окно пересекается с поездкой.
 *
 * Условия НЕ перечислены здесь — берутся из `matchingRideRequestWhere`, тем же
 * предикатом, что и `GET /trips/:id/requests` и уведомления при создании
 * поездки. Своя копия условий разошлась бы с тем, что водитель видит на
 * экране спроса, и позволила бы позвать того, кто под поездку не подходил.
 */
async function findInvitableRequest(requestId: string, trip: TripWithRoute) {
  return db.rideRequest.findFirst({
    where: { id: requestId, ...matchingRideRequestWhere(trip) },
    select: { id: true, userId: true },
  });
}

/**
 * Уже отправленное приглашение этой же пары (заявка + поездка) — вернуть его
 * id, чтобы повтор был идемпотентным, а не вторым уведомлением в инбоксе.
 *
 * В отличие от общего дедупа `findNotificationDuplicate` (окно в часах) здесь
 * проверка без окна: повторное нажатие «Пригласить» — это тот же жест по той
 * же кнопке, а не «новое событие», и ждать истечения окна не должен никто.
 */
async function findInviteNotification(input: {
  requestId: string;
  tripId: string;
  userId: string;
}) {
  return db.notification.findFirst({
    where: {
      userId: input.userId,
      type: DRIVER_INVITE_NOTIFICATION_TYPE,
      body: { contains: invitePairKey(input.requestId, input.tripId) },
    },
    select: { id: true },
  });
}

/**
 * Уведомление-приглашение. Ровно одна запись на пару (заявка, поездка) —
 * защита от дубля живёт в теле (маркер пары), см. `findInviteNotification`.
 *
 * `notifyUser` — существующий путь уведомлений: он же уважает тумблер
 * получателя, сам гасит WS-hint при пропуске и кладёт задачу в outbox для
 * диспетчера. `driver_invite` не критичен, поэтому отдельного кода «написать
 * в Telegram» не нужно — канал и его лимиты уже там.
 *
 * null — пропуск (выключенный тумблер) или сбой; вызывающий отдаёт это
 * значение клиенту как есть, не выдавая пропуск за доставленное приглашение.
 */
async function notifyDriverInvite(input: {
  trip: TripForInvite;
  driverName: string;
  recipientId: string;
  requestId: string;
}): Promise<string | null> {
  return notifyUser({
    userId: input.recipientId,
    type: DRIVER_INVITE_NOTIFICATION_TYPE,
    title: "Водитель приглашает в поездку",
    body:
      "Водитель позвал вас в свою поездку. Откройте поездку и забронируйте место. " +
      invitePairKey(input.requestId, input.trip.id),
    // Allowlist-маршрут `/trips/<uuid>` и ничего кроме: без query, hash и сырых
    // данных (resolveTelegramDeepLink отверг бы иначе, и тап вёлся бы в inbox).
    fragment: `/trips/${input.trip.id}`,
    actorName: input.driverName,
    // Машинный код для третьей строки ячейки. Словарь подписей живёт в клиенте
    // (NotificationsPage.NOTIFICATION_ACTION_LABELS) — там ему добавляют
    // «invited» вместе с UI приглашения.
    action: "invited",
    tripSnapshot: tripSnapshotOf(input.trip),
    role: "passenger",
  });
}

/**
 * `POST /ride-requests/:id/invite` — водитель зовёт пассажира в свою поездку.
 *
 * Порядок проверок повторяет `GET /trips/:id/requests`: сначала существование
 * поездки (404), потом права (403) — иначе посторонний узнал бы из 403, что
 * поездка с таким id вообще есть. Дальше состояние поездки и свободные места,
 * и лишь потом «подходит ли заявка»: приглашение в поездку без мест — тупик,
 * и отправлять о нём пассажиру незачем (тот же предикат, что в
 * `bookings/create.ts`).
 *
 * Бронь не создаётся и заявка не меняется: приглашение — только уведомление.
 */
rideRequestsRouter.post(
  "/:id/invite",
  mutationLimiter,
  rideRequestMutationLimiter,
  async (c) => {
    const parsed = inviteRideRequestBodySchema.safeParse(
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

    const requestId = c.req.param("id");
    const tripId = parsed.data.tripId;
    const driver = c.get("user");

    const trip = await db.trip.findUnique({ where: { id: tripId } });
    if (!trip)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Trip not found" },
        404,
      );
    if (trip.driverId !== driver.id)
      return c.json(
        { code: ERROR_CODES.FORBIDDEN, message: "Forbidden" },
        403,
      );
    if (trip.status !== "active")
      return c.json(
        { code: ERROR_CODES.TRIP_NOT_ACTIVE, message: "Trip is not active" },
        409,
      );
    if (trip.seatsAvailable <= 0)
      return c.json(
        {
          code: ERROR_CODES.CONFLICT,
          message: "Not enough available seats",
        },
        409,
      );

    // withRoute null у старых поездок без FK на справочник: подбирать нечем,
    // значит и приглашать некого — ветка даёт тот же 404, что и несовпадение.
    const route = withRoute(trip);
    const request = route ? await findInvitableRequest(requestId, route) : null;
    // Несуществующая и несовпадающая заявка неразличимы (404, а не 409):
    // иначе эндпоинт служил бы оракулом существования чужих заявок.
    if (!request)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Ride request not found" },
        404,
      );

    const existing = await findInviteNotification({
      requestId: request.id,
      tripId: trip.id,
      userId: request.userId,
    });
    // Повтор — не ошибка: клиент показывает «Приглашение отправлено» и не
    // рассылает второе уведомление (псевдо-идемпотентность, как в брони).
    if (existing)
      return c.json({
        invited: true,
        duplicate: true,
        notificationId: existing.id,
      });

    const notificationId = await notifyDriverInvite({
      trip,
      driverName: driver.name,
      recipientId: request.userId,
      requestId: request.id,
    });

    logBusinessEvent("ride_request.driver_invited", {
      requestId: request.id,
      tripId: trip.id,
      driverId: driver.id,
      passengerId: request.userId,
      // false — приглашение записано, но у получателя выключен тумблер.
      notified: notificationId !== null,
    });

    return c.json({ invited: true, duplicate: false, notificationId }, 201);
  },
);
