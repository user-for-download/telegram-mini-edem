import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Гейт подбора пассажиров при СОЗДАНИИ поездки: `matchingEnabled = false` →
 * ни одного уведомления `ride_request_match`, `true` → уведомление пассажиру.
 *
 * Это единственное живое направление пересечения заявки и поездки: пассажир
 * публикует заявку, водитель создаёт поездку, и пассажир получает уведомление
 * «Подходящая поездка» со ссылкой на неё. Обратного канала (водителю о новом
 * попутчике) нет — по решению владельца от 2026-10-09 спрос остался
 * витриной на главной, без экрана водителя, поэтому `GET /trips/:id/requests`
 * и WS-хинт `ride_request:new` удалены вместе с ним.
 *
 * Файл выделен из бывшего `trip-ride-requests.test.ts`: там были кейсы чтения
 * спроса водителем (эндпоинта больше нет), а гейт уведомлений проверяет живое
 * поведение и остаётся.
 *
 * Паттерны репо: app.request() вместо supertest, dev mock-токены, уникальные
 * telegramUserId и города, уборка в обратном порядке зависимостей
 * (уведомления → заявки → поездки → юзеры → города).
 */

const HOUR = 3_600_000;

/** telegramUserId — BigInt: счётчик вместо Date.now() (выходит за 32 бита). */
let tgSeq = 5_400_000n;

async function createUser(name: string): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `${name}-${tgSeq}`,
      telegramUserId: ++tgSeq,
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

describe("уведомление о подходящей поездке", () => {
  let driverId: string;
  let passengerId: string;
  let fromCityId: string;
  let toCityId: string;
  let otherToCityId: string;
  const createdTripIds: string[] = [];

  /**
   * Поездка для кейсов про гейт: на 9 суток. Смещение нужно по двум
   * причинам: у поездок одного водителя не должно пересекаться окон (иначе
   * 409 TRIP_OVERLAP), и заявка под неё создаётся со своим окном — иначе
   * подбор не сойдётся и тест проверял бы несовпадение вместо гейта.
   */
  const gateDeparture = () => new Date(Date.now() + 9 * 24 * HOUR);
  const farFuture = new Date(Date.now() + 365 * 24 * HOUR);

  const gateTripBody = (matchingEnabled: boolean) => ({
    fromCity: `Gate from ${tgSeq}`,
    fromAddress: "ул. Отправления, 1",
    toCity: `Gate to ${tgSeq}`,
    toAddress: "ул. Назначения, 2",
    fromCityId,
    toCityId,
    departureAt: gateDeparture().toISOString(),
    durationMinutes: 60,
    distanceKm: 120,
    price: 500,
    seatsTotal: 3,
    tags: [],
    matchingEnabled,
  });

  /** Заявка, совпадающая с `gateTripBody` по маршруту и окну. */
  const gateRequest = () =>
    db.rideRequest.create({
      data: {
        userId: passengerId,
        fromCityId,
        toCityId,
        earliestAt: new Date(gateDeparture().getTime() - HOUR),
        latestAt: new Date(gateDeparture().getTime() + 2 * HOUR),
        expiresAt: farFuture,
      },
    });

  beforeEach(async () => {
    createdTripIds.length = 0;
    driverId = await createUser("Gate driver");
    // Автомобиль обязателен для POST /trips: без него бэк отдаёт 400 NO_CAR,
    // и проверка флага не была бы достигнута. Удаляется каскадом с юзером.
    await db.car.create({
      data: { userId: driverId, model: "Test", color: "Black" },
    });
    passengerId = await createUser("Gate passenger");

    fromCityId = await createCity(`Gate from ${tgSeq}`);
    toCityId = await createCity(`Gate to ${tgSeq}`);
    otherToCityId = await createCity(`Gate other ${tgSeq}`);
  });

  afterEach(async () => {
    const userIds = [driverId, passengerId];
    // Порядок обязателен: уведомления ссылаются на поездки и юзеров, заявки и
    // поездки — на юзеров и города (Restrict).
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({
      where: { id: { in: [fromCityId, toCityId, otherToCityId] } },
    });
  });

  function auth(user: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(user)}` };
  }

  async function createTrip(matchingEnabled: boolean): Promise<string> {
    const response = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(driverId) },
      body: JSON.stringify(gateTripBody(matchingEnabled)),
    });
    expect(response.status).toBe(201);
    const id = (await response.json()).id as string;
    createdTripIds.push(id);
    return id;
  }

  const matchNotifications = () =>
    db.notification.findMany({
      where: { userId: passengerId, type: "ride_request_match" },
    });

  it("выключенный подбор не создаёт НИ ОДНОГО уведомления о совпадении", async () => {
    // Arrange: заявка совпадает по маршруту и окну с поездкой, которую сейчас
    // создадим, — при включённом подборе уведомление было бы.
    await gateRequest();

    // Act
    await createTrip(false);

    // Assert: рассылка fire-and-forget (`void … .catch()` в trips/index.ts),
    // поэтому «пока нет записи» ничего не доказывает — без ожидания тест
    // проходил бы и при СЛОМАННОМ гейте. Ждём окно, в котором запись обязана
    // была бы появиться, и лишь затем утверждаем её отсутствие.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await matchNotifications()).toEqual([]);
  });

  it("включённый подбор уведомляет пассажира — поведение не изменилось", async () => {
    // Arrange: та же заявка, но флаг поездки — включён. Это регресс на «гейт
    // не съел обычный путь»: без проверки выключатель тихо выключил бы подбор
    // у всех поездок, и уведомления перестали бы приходить вообще.
    await gateRequest();

    // Act
    const tripId = await createTrip(true);

    // Assert: тот же fire-and-forget — ждём появления записи, а не ловим гонку.
    await vi.waitFor(async () => {
      const rows = await matchNotifications();
      expect(rows).toHaveLength(1);
      // Тело несёт маркер с id поездки (и он же основа дедупа) + deep-link.
      expect(rows[0]?.body).toContain(tripId);
      expect(rows[0]?.deepLink).toBe(`/trips/${tripId}`);
    });
  });
});
