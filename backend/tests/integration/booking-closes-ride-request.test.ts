import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { closeRideRequestsForBooking } from "../../src/bookings/rideRequests.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Слой 2 «заявка → поездка»: бронь закрывает заявку, из которой выросла,
 * и получает её id в `Booking.requestId` — в той же транзакции, что и сама
 * бронь (`bookings/create.ts` → `bookings/rideRequests.ts`).
 *
 * Что здесь зафиксировано (каждое «не» — тоже контракт):
 * - без клиентского `requestId` сервер сам закрывает ВСЕ совпавшие активные
 *   заявки пассажира и проставляет самую раннюю по `createdAt`;
 * - пассажир без заявок (обычный случай) — no-op: `requestId` остаётся null;
 * - клиентский `requestId` — приоритетный: закрывается ровно названная
 *   заявка, остальные совпавшие остаются `active` («не догадываться за
 *   клиента»);
 * - неподходящие заявки (другой маршрут, непересекающееся окно, не
 *   активная, просроченная) не закрываются никогда;
 * - невалидный `requestId` (чужой или не подходящий под поездку) — 4xx и
 *   НОЛЬ броней: клиентский выбор не доверен, но и не игнорируется;
 * - атомарность: сбой внутри транзакции откатывает и закрытие заявки, и
 *   бронь — «бронь есть, заявка висит» в продукте не бывает.
 *
 * Паттерны репо (см. ride-requests.test.ts, trip-ride-request-notify.test.ts,
 * booking-conflicts.test.ts): app.request() вместо supertest, dev mock-токены,
 * уникальные telegramUserId (BigInt-счётчик) и города, относительные даты от
 * общей базы, уборка в обратном порядке зависимостей (уведомления → брони →
 * заявки → поездки → юзеры → города).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const HOUR = 3_600_000;

// Отправление поездки — через неделю от «сейчас», рейс 60 минут, значит
// tripEnd = отправление + 1ч. Относительное время во всём файле: абсолютный
// год уехал бы в прошлое вместе с системными часами, и «непересекающееся»
// окно заявки в тестах ниже молча стало бы подходящим (баг, уже случившийся
// сегодня в trip-ride-requests.test.ts).
const TRIP_DEPARTURE = new Date(Date.now() + 7 * 24 * HOUR);
const TRIP_DURATION_MINUTES = 60;

/** Границы окон заявок — в часах ОТ отправления поездки. */
const shift = (hours: number): Date =>
  new Date(TRIP_DEPARTURE.getTime() + hours * HOUR);

/** Срок заявки — заведомо после отправления, иначе она выпадет из подбора. */
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * HOUR);

/** telegramUserId — BigInt: счётчик, а не Date.now() (вышел бы за 32 бита). */
let tgSeq = 7_900_000n;

/** Юзер с уникальным именем (имя нужно для строк уведомлений). */
async function createUser(name: string): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `${name}-${++tgSeq}`,
      telegramUserId: tgSeq,
      avatar: "",
    },
  });
  return user.id;
}

async function createCity(name: string): Promise<string> {
  const city = await db.city.create({
    data: { name, nameNormalized: name.trim().toLowerCase() },
  });
  return city.id;
}

/**
 * Заявка с явными окном и сроком — предикат подбора проверяет все три плюс
 * маршрут. `createdAt` задаётся явно там, где важна ОЧЕРЁДНОСТЬ заявок:
 * полагаться на время вставки нельзя.
 */
async function createRequest(params: {
  userId: string;
  fromCityId: string;
  toCityId: string;
  earliestAt: Date;
  latestAt: Date;
  expiresAt?: Date;
  status?: string;
  createdAt?: Date;
}): Promise<string> {
  const request = await db.rideRequest.create({
    data: {
      userId: params.userId,
      fromCityId: params.fromCityId,
      toCityId: params.toCityId,
      earliestAt: params.earliestAt,
      latestAt: params.latestAt,
      expiresAt: params.expiresAt ?? FAR_FUTURE,
      status: params.status ?? "active",
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });
  return request.id;
}

/** Ответ POST /bookings: успех — DTO брони, отказ — { code, message }. */
type BookingResponse = {
  id?: string;
  seat?: number;
  status?: string;
  code?: string;
  message?: string;
};

describe("booking closes its ride request: POST /bookings", () => {
  let driverId: string;
  let passengerId: string;
  let strangerId: string;
  let fromCityId: string;
  let toCityId: string;
  let otherToCityId: string;
  let tripId: string;

  beforeEach(async () => {
    driverId = await createUser("Booking-closes driver");
    passengerId = await createUser("Booking-closes passenger");
    strangerId = await createUser("Booking-closes stranger");

    fromCityId = await createCity(`Closes from ${tgSeq}`);
    toCityId = await createCity(`Closes to ${tgSeq}`);
    otherToCityId = await createCity(`Closes other to ${tgSeq}`);

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: `Closes from ${tgSeq}`,
        fromAddress: "ул. Отправления, 1",
        toCity: `Closes to ${tgSeq}`,
        toAddress: "ул. Назначения, 2",
        fromCityId,
        toCityId,
        departureAt: TRIP_DEPARTURE,
        durationMinutes: TRIP_DURATION_MINUTES,
        distanceKm: 120,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
  });

  afterEach(async () => {
    const userIds = [driverId, passengerId, strangerId];
    // Порядок обязателен: уведомления и брони ссылаются на юзеров/поездки,
    // заявки — на юзеров и города (Restrict), города — на заявки.
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.booking.deleteMany({ where: { tripId } });
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({
      where: { id: { in: [fromCityId, toCityId, otherToCityId] } },
    });
  });

  function auth(user: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(user)}` };
  }

  async function book(params: {
    passengerId: string;
    seat?: number;
    requestId?: string;
  }): Promise<{ status: number; body: BookingResponse }> {
    const response = await app.request("/api/v1/bookings", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(params.passengerId) },
      body: JSON.stringify({
        tripId,
        seat: params.seat ?? 1,
        ...(params.requestId ? { requestId: params.requestId } : {}),
      }),
    });
    return {
      status: response.status,
      body: (await response.json()) as BookingResponse,
    };
  }

  /** id брони из успешного ответа — без него утверждать нечего. */
  function bookingIdOf(body: BookingResponse): string {
    if (!body.id) {
      throw new Error("Unexpected response shape: booking id missing");
    }
    return body.id;
  }

  /** Заявка, подходящая под поездку: тот же маршрут, окно шире рейса. */
  function matchingRequestParams(userId: string) {
    return {
      userId,
      fromCityId,
      toCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
    };
  }

  /** Статус заявки в БД — единственный источник правды о закрытии. */
  async function statusOf(requestId: string): Promise<string | undefined> {
    const request = await db.rideRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    return request?.status;
  }

  /** Проставленный в бронь id заявки: null — бронь выросла не из заявки. */
  async function stampedRequestId(bookingId: string): Promise<string | null> {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { requestId: true },
    });
    return booking?.requestId ?? null;
  }

  async function seatsAvailable(): Promise<number | undefined> {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: { seatsAvailable: true },
    });
    return trip?.seatsAvailable;
  }

  it("closes the matching request and stamps it into Booking.requestId", async () => {
    // Arrange
    const requestId = await createRequest(matchingRequestParams(passengerId));

    // Act
    const { status, body } = await book({ passengerId });

    // Assert: бронь создана, заявка из неё выросла — помечена в requestId.
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(await stampedRequestId(bookingIdOf(body))).toBe(requestId);
    expect(await statusOf(requestId)).toBe("fulfilled");
  });

  it("closes every matching request and stamps the earliest by createdAt", async () => {
    // Arrange: две совпавшие заявки. Вставляем СНАЧАЛА более позднюю, чтобы
    // «кто первая встал в очередь» не совпало с «кто раньше создан» —
    // иначе тест проверял бы время вставки вместо orderBy(createdAt asc).
    const laterId = await createRequest({
      ...matchingRequestParams(passengerId),
      createdAt: shift(-3),
    });
    const earlierId = await createRequest({
      ...matchingRequestParams(passengerId),
      createdAt: shift(-5),
    });

    // Act
    const { status, body } = await book({ passengerId });

    // Assert: обе закрыты (одна бронь удовлетворяет одно и то же окно), а в
    // requestId — витринная, самая ранняя.
    expect(status).toBe(201);
    expect(await statusOf(earlierId)).toBe("fulfilled");
    expect(await statusOf(laterId)).toBe("fulfilled");
    expect(await stampedRequestId(bookingIdOf(body))).toBe(earlierId);
  });

  it("books a passenger without requests as a no-op (requestId stays null)", async () => {
    // Arrange: заявок нет вообще — обычный случай.

    // Act
    const { status, body } = await book({ passengerId });

    // Assert: поведение не изменилось, закрывать нечего.
    expect(status).toBe(201);
    expect(await stampedRequestId(bookingIdOf(body))).toBeNull();
    expect(
      await db.rideRequest.count({ where: { userId: passengerId } }),
    ).toBe(0);
    // Место удержано как обычно — no-op не мешает самой брони.
    expect(await seatsAvailable()).toBe(2);
  });

  it("closes only the request the client named and leaves the other active", async () => {
    // Arrange: обе заявки подходят под поездку, клиент назвал конкретную.
    const chosenId = await createRequest({
      ...matchingRequestParams(passengerId),
      createdAt: shift(-3),
    });
    const otherId = await createRequest({
      ...matchingRequestParams(passengerId),
      createdAt: shift(-5),
    });

    // Act
    const { status, body } = await book({
      passengerId,
      requestId: chosenId,
    });

    // Assert: явный выбор клиента — приоритетный, за остальные не догадываемся.
    expect(status).toBe(201);
    expect(await stampedRequestId(bookingIdOf(body))).toBe(chosenId);
    expect(await statusOf(chosenId)).toBe("fulfilled");
    expect(await statusOf(otherId)).toBe("active");
  });

  it("rejects a requestId owned by another user and creates no booking", async () => {
    // Arrange: подходящая заявка, но она чужая — оракулом существования
    // чужих заявок эндпоинт быть не должен.
    const strangerRequestId = await createRequest(
      matchingRequestParams(strangerId),
    );

    // Act
    const { status, body } = await book({
      passengerId,
      requestId: strangerRequestId,
    });

    // Assert: 404 и ноль броней; заявка и место не тронуты.
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(await db.booking.count({ where: { tripId } })).toBe(0);
    expect(await statusOf(strangerRequestId)).toBe("active");
    // Откат транзакции: место не «съедено» неудачной попыткой.
    expect(await seatsAvailable()).toBe(3);
  });

  it("rejects a requestId whose window does not match the trip", async () => {
    // Arrange: заявка СВОЯ, но окно заканчивается ДО отправления — ровно тот
    // предикат, который отсекает `matchingRideRequestWhere`.
    const requestId = await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-4),
      latestAt: shift(-2),
    });

    // Act
    const { status, body } = await book({ passengerId, requestId });

    // Assert: не подошло — 404, а не «бронь без привязки».
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(await db.booking.count({ where: { tripId } })).toBe(0);
    expect(await statusOf(requestId)).toBe("active");
    expect(await seatsAvailable()).toBe(3);
  });

  it("leaves non-matching requests alone on an ordinary booking", async () => {
    // Arrange: у пассажира пять заявок, под поездку подходит ровно одна.
    const matchingId = await createRequest(matchingRequestParams(passengerId));
    const otherRouteId = await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId: otherToCityId,
      earliestAt: shift(-1),
      latestAt: shift(2),
    });
    const noOverlapId = await createRequest({
      userId: passengerId,
      fromCityId,
      toCityId,
      earliestAt: shift(-4),
      latestAt: shift(-2),
    });
    const pausedId = await createRequest({
      ...matchingRequestParams(passengerId),
      status: "paused",
    });
    const expiredId = await createRequest({
      ...matchingRequestParams(passengerId),
      expiresAt: new Date(Date.now() - 60_000),
    });

    // Act
    const { status, body } = await book({ passengerId });

    // Assert: закрылась только совпавшая, остальные — как были.
    expect(status).toBe(201);
    expect(await stampedRequestId(bookingIdOf(body))).toBe(matchingId);
    expect(await statusOf(matchingId)).toBe("fulfilled");
    expect(await statusOf(otherRouteId)).toBe("active");
    expect(await statusOf(noOverlapId)).toBe("active");
    // Неактивная остаётся неактивной (не во что превращать), просроченная —
    // активной, но вне подбора.
    expect(await statusOf(pausedId)).toBe("paused");
    expect(await statusOf(expiredId)).toBe("active");
  });

  it("leaves another passenger's matching request active", async () => {
    // Arrange: заявка по маршруту и окну ИДЕАЛЬНО подходит поездке, но
    // принадлежит другому человеку. Закрывать её нельзя: бронь одного
    // пассажира не исполняет пожелание другого.
    // Регресс: общего предиката достаточно, чтобы найти такую заявку, если
    // раскладка `userId` пассажира придёт ДО спреда (предикат возвращает
    // `userId: { not: driverId }` и затирает его) — тогда любая бронь молча
    // закрывала бы чужие заявки.
    const mineId = await createRequest(matchingRequestParams(passengerId));
    const strangerRequestId = await createRequest(
      matchingRequestParams(strangerId),
    );

    // Act
    const { status, body } = await book({ passengerId });

    // Assert: закрыта только своя заявка.
    expect(status).toBe(201);
    expect(await stampedRequestId(bookingIdOf(body))).toBe(mineId);
    expect(await statusOf(mineId)).toBe("fulfilled");
    expect(await statusOf(strangerRequestId)).toBe("active");
  });

  it("rolls back the request closure together with the booking on failure", async () => {
    // Arrange
    const requestId = await createRequest(matchingRequestParams(passengerId));

    // Act: та же последовательность, что в bookings/create.ts, но с
    // принудительным сбоем ПОСЛЕ вставки брони.
    const attempt = db.$transaction(
      async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({
          where: { id: tripId },
        });
        await tx.trip.update({
          where: { id: tripId },
          data: { seatsAvailable: { decrement: 1 } },
        });
        const closed = await closeRideRequestsForBooking(tx, {
          trip,
          passengerId,
        });
        await tx.booking.create({
          data: {
            tripId,
            passengerId,
            requestId: closed.stampedRequestId,
            seat: 1,
            status: "pending",
          },
        });
        throw new Error("forced failure after closing the request");
      },
      { isolationLevel: "Serializable" },
    );

    await expect(attempt).rejects.toThrow(
      "forced failure after closing the request",
    );

    // Assert: состояние не осталось частичным — ни брони, ни закрытой заявки,
    // ни съеденного места.
    expect(await db.booking.count({ where: { tripId } })).toBe(0);
    expect(await statusOf(requestId)).toBe("active");
    expect(await seatsAvailable()).toBe(3);
  });
});
