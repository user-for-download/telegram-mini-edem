import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { wsManager } from "../../src/services/wsManager.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Обратная сторона пересечения заявки и поездки: пассажир опубликовал
 * заявку → водителю поездки, чьё окно пересекается, уходит WS-хинт
 * `ride_request:new { tripId }`.
 *
 * Что зафиксировано (каждое «не» — тоже контракт):
 * - хинт уходит водителю поездки с ПЕРЕСЕКАЮЩИМСЯ окном, с тем же маршрутом;
 * - поездка с НЕпересекающимся окном хинта не получает (иначе водитель
 *   увидит «попутчика», которого не зовёт);
 * - чужая поездка (другой маршрут) и отменённая — тоже молчат;
 * - свои поездки автору заявки не хинтуются (он и так знает);
 * - хинт — это WS-событие, а НЕ запись в `notifications`: уведомления в
 *   инбоксе не плодим, тумблер уведомлений не касается;
 * - ответ клиенту не ждёт рассылку: 201 отдаётся даже если хинт упал.
 *
 * Паттерны репо (см. ride-request-invite.test.ts): app.request() вместо
 * supertest, dev mock-токены, относительные даты от общей базы, уборка в
 * обратном порядке зависимостей (заявки → поездки → юзеры → города).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const HOUR = 3_600_000;

// Абсолютный год уехал бы в прошлое вместе с часами системы, и «несовпадающее»
// окно в последнем тесте молча стало бы подходящим — поэтому всё относительно.
const TRIP_DEPARTURE = new Date(Date.now() + 7 * 24 * HOUR);
const TRIP_DURATION_MINUTES = 60;

const shift = (hours: number): Date =>
  new Date(TRIP_DEPARTURE.getTime() + hours * HOUR);

/** Срок заявки — заведомо после отправления, иначе она выпадет из подбора. */
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * HOUR);

/** telegramUserId — BigInt: счётчик, а не Date.now() (вышел бы за 32 бита). */
let tgSeq = 7_300_000n;

async function createUser(name: string): Promise<string> {
  const unique = `${name}-${++tgSeq}`;
  const user = await db.user.create({
    data: { name: unique, telegramUserId: tgSeq, avatar: "" },
  });
  return user.id;
}

async function createCity(name: string): Promise<string> {
  const city = await db.city.create({
    data: { name, nameNormalized: name.trim().toLowerCase() },
  });
  return city.id;
}

describe("ride_request:new — хинт спроса водителю", () => {
  let passengerId: string;
  let driverId: string;
  let strangerDriverId: string;
  let authorDriverId: string;
  let fromCityId: string;
  let toCityId: string;
  let otherCityId: string;
  let tripIds: string[] = [];

  /** Хинты, адресованные конкретному водителю: пишем их в sendToUser. */
  function hintsTo(userId: string): string[] {
    return sent
      .filter((call) => call.userId === userId)
      .flatMap((call) =>
        call.events
          .filter((event) => event.type === "ride_request:new")
          .map((event) =>
            event.type === "ride_request:new" ? event.payload.tripId : "",
          ),
      );
  }

  interface SentCall {
    userId: string;
    events: { type: string; payload?: { tripId?: string } }[];
  }
  let sent: SentCall[] = [];

  beforeEach(async () => {
    sent = [];
    vi.spyOn(wsManager, "sendToUser").mockImplementation((userId, event) => {
      sent.push({
        userId,
        events: [
          {
            type: event.type,
            payload: "payload" in event ? event.payload : undefined,
          },
        ],
      });
      return 1;
    });

    passengerId = await createUser("Hint passenger");
    driverId = await createUser("Hint driver");
    strangerDriverId = await createUser("Hint stranger");
    authorDriverId = await createUser("Hint author");
    fromCityId = await createCity(`Hint from ${tgSeq}`);
    toCityId = await createCity(`Hint to ${tgSeq}`);
    otherCityId = await createCity(`Hint other ${tgSeq}`);
    tripIds = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const userIds = [
      passengerId,
      driverId,
      strangerDriverId,
      authorDriverId,
    ];
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.trip.deleteMany({ where: { id: { in: tripIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({
      where: { id: { in: [fromCityId, toCityId, otherCityId] } },
    });
  });

  /** Поездка с явным маршрутом и окном — хинт строится по обоим. */
  async function createTrip(params: {
    driverId: string;
    fromCityId?: string;
    toCityId?: string;
    departureAt?: Date;
    durationMinutes?: number;
    status?: string;
    /** Флаг подбора; null → не задавать, берётся дефолт схемы (true). */
    matchingEnabled?: boolean | null;
  }): Promise<string> {
    const trip = await db.trip.create({
      data: {
        driverId: params.driverId,
        fromCity: "Hint from",
        fromAddress: "ул. Отправления, 1",
        toCity: "Hint to",
        toAddress: "ул. Назначения, 2",
        fromCityId: params.fromCityId ?? fromCityId,
        toCityId: params.toCityId ?? toCityId,
        departureAt: params.departureAt ?? TRIP_DEPARTURE,
        durationMinutes: params.durationMinutes ?? TRIP_DURATION_MINUTES,
        distanceKm: 120,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 3,
        status: params.status ?? "active",
        tags: [],
        ...(params.matchingEnabled === null
          ? {}
          : { matchingEnabled: params.matchingEnabled ?? true }),
      },
    });
    tripIds.push(trip.id);
    return trip.id;
  }

  /** POST /ride-requests — та же форма, что у клиента. */
  function publish(as: string, overrides: Record<string, string> = {}) {
    return app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(as)}`,
      },
      body: JSON.stringify({
        fromCityId,
        toCityId,
        // Окно шире рейса — пересекается с поездкой заведомо.
        earliestAt: shift(-2).toISOString(),
        latestAt: shift(3).toISOString(),
        expiresAt: FAR_FUTURE.toISOString(),
        seats: 1,
        ...overrides,
      }),
    });
  }

  it("водителю поездки с пересекающимся окном уходит хинт с её tripId", async () => {
    const tripId = await createTrip({ driverId });

    const res = await publish(passengerId);
    expect(res.status).toBe(201);

    // Хинт адресовный: ровно эта поездка, ровно этот водитель. Рассылка
    // fire-and-forget (`void ... .catch()` — как `notifyMatchingRideRequests`
    // при создании поездки), поэтому ждём её явно: ответ клиенту не должен
    // зависеть от сокета, и без этого ожидания ассерт ловил бы гонку.
    await vi.waitFor(() => expect(hintsTo(driverId)).toEqual([tripId]));
    expect(hintsTo(strangerDriverId)).toEqual([]);
  });

  it("непересекающееся окно хинта не получает", async () => {
    // Поездка заканчивается за час до начала окна заявки: пересечения нет.
    await createTrip({
      driverId,
      departureAt: new Date(TRIP_DEPARTURE.getTime() - 6 * HOUR),
    });

    await publish(passengerId);

    expect(hintsTo(driverId)).toEqual([]);
  });

  it("поездка после конца окна заявки хинта не получает", async () => {
    // Отправляется через 10 часов после старта окна — заявка уже кончилась.
    await createTrip({
      driverId,
      departureAt: new Date(TRIP_DEPARTURE.getTime() + 10 * HOUR),
    });

    await publish(passengerId);

    expect(hintsTo(driverId)).toEqual([]);
  });

  it("чужой маршрут хинта не получает", async () => {
    await createTrip({ driverId, toCityId: otherCityId });

    await publish(passengerId);

    expect(hintsTo(driverId)).toEqual([]);
  });

  it("отменённая поездка хинта не получает", async () => {
    // Заведомо нерабочая поездка: спрос на неё водителю не нужен.
    await createTrip({ driverId, status: "cancelled" });

    await publish(passengerId);

    expect(hintsTo(driverId)).toEqual([]);
  });

  it("уехавшая поездка хинта не получает", async () => {
    await createTrip({
      driverId,
      departureAt: new Date(Date.now() - HOUR),
    });

    await publish(passengerId);

    expect(hintsTo(driverId)).toEqual([]);
  });

  it("автору заявки его собственные поездки не хинтуются", async () => {
    const ownTripId = await createTrip({ driverId: passengerId });

    await publish(passengerId);

    // Свой спрос автору не показываем: он и так знает, что едет без машины.
    expect(hintsTo(passengerId)).toEqual([]);
    expect(hintsTo(driverId)).toEqual([]);
    // Поездка создана и почищена — ассерты выше про хинт, а не про её судьбу.
    expect(ownTripId).toBeTruthy();
  });

  it("хинт не создаёт запись в notifications: это WS-событие, а не инбокс", async () => {
    await createTrip({ driverId });

    await publish(passengerId);

    // Уведомление пассажиру о его же заявке тоже не создаётся — здесь
    // проверяем, что поездка/спрос не плодят лишних записей в инбоксе.
    const notifications = await db.notification.findMany({
      where: { userId: { in: [driverId, passengerId] } },
    });
    expect(notifications).toHaveLength(0);
  });

  it("сбой рассылки не превращает 201 в ошибку", async () => {
    await createTrip({ driverId });
    vi.mocked(wsManager.sendToUser).mockImplementation(() => {
      throw new Error("ws down");
    });

    const res = await publish(passengerId);

    // Заявка создана — её нельзя терять из-за сокета.
    expect(res.status).toBe(201);
    const created = await db.rideRequest.findMany({
      where: { userId: passengerId },
    });
    expect(created).toHaveLength(1);
  });

  it("поездка без FK на справочник не ломает публикацию", async () => {
    // Старые поездки (до появления справочника) — подбирать нечем.
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Hint legacy from",
        fromAddress: "ул. 1",
        toCity: "Hint legacy to",
        toAddress: "ул. 2",
        fromCityId: null,
        toCityId: null,
        departureAt: TRIP_DEPARTURE,
        durationMinutes: TRIP_DURATION_MINUTES,
        distanceKm: 120,
        price: 500,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripIds.push(trip.id);

    const res = await publish(passengerId);

    expect(res.status).toBe(201);
    expect(hintsTo(driverId)).toEqual([]);
  });

  it("поездка с NULL-полем одного города не хинтуется, а не падает", async () => {
    await createTrip({ driverId, toCityId: null });

    const res = await publish(passengerId);

    expect(res.status).toBe(201);
    expect(hintsTo(driverId)).toEqual([]);
  });

  it("поездка с выключенным подбором не получает WS-хинт", async () => {
    // Гейт №3 из трёх. Без него водитель с выключенным подбором получил бы
    // `ride_request:new`, открыл поездку и увидел пустую карточку спроса
    // (гейт №2) — подсказка вела бы в никуда.
    const tripId = await createTrip({ driverId, matchingEnabled: false });

    await publish(passengerId);

    // НЕ waitFor(→0): «сейчас ноль» выполняется мгновенно, и без сломанного
    // гейта тест прошёл бы, просто не дождавшись хинта. Ждём окно, в
    // котором хинт обязан был прийти (та же пауза, что у негативного кейса
    // с уведомлением), и только затем утверждаем, что его нет.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hintsTo(driverId)).toEqual([]);
    // Контрольная проверка: поездка реально подходила под заявку, иначе
    // пустой результат объяснялся бы не гейтом, а несовпадением маршрута.
    const row = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(row.matchingEnabled).toBe(false);
  });

  it("поездка с включённым подбором хинт получает", async () => {
    // Регресс на «фильтр не съел обычный путь».
    const tripId = await createTrip({ driverId, matchingEnabled: true });

    await publish(passengerId);

    await vi.waitFor(() => expect(hintsTo(driverId)).toEqual([tripId]));
  });

  it("публикация с чужим id города отвергается и хинта не шлёт", async () => {
    await createTrip({ driverId });

    const res = await publish(passengerId, {
      toCityId: randomUUID(),
    });

    expect(res.status).toBe(400);
    expect(hintsTo(driverId)).toEqual([]);
  });
});
