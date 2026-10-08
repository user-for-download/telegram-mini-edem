import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { wsManager } from "../../src/services/wsManager.js";
import { PENDING_BOOKING_TTL_MS } from "../../src/bookings/shared.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Сквозной сценарий опций поездки: дефолты, три гейта подбора и совместимость
 * с кодом, который новых полей не знает.
 *
 * Зачем отдельный файл, если гейты проверяются и по частям:
 * главная цена регресса здесь — «забыли ОДНО из трёх мест». Уведомления,
 * чтение спроса и WS-хинт живут в разных модулях, и каждый по отдельности
 * выглядит правильным. Поэтому ключевой кейс здесь один: при
 * `matchingEnabled = false` все три канала молчат ОБРАЗОМ, в одном сценарии,
 * на одной поездке.
 *
 * Сроки автозавершения проверяет `trip-worker-auto-complete.test.ts` — там
 * нужен реальный воркер с относительными часами. Дублировать эти кейсы здесь
 * нельзя: два места, где меняется воркер, разъедутся.
 *
 * Даты относительные: абсолютный год уехал бы в прошлое вместе с часами.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const HOUR = 3_600_000;
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * HOUR);
let tgSeq = 8_800_000n;

describe("опции поездки: сквозной сценарий", () => {
  let driverId: string;
  let passengerId: string;
  let fromCityId: string;
  let toCityId: string;
  let tripIds: string[] = [];

  beforeEach(async () => {
    const driver = await db.user.create({
      data: {
        name: `Options e2e driver-${++tgSeq}`,
        telegramUserId: tgSeq,
        avatar: "",
      },
    });
    driverId = driver.id;
    // Автомобиль обязателен для POST /trips (400 NO_CAR без него).
    await db.car.create({
      data: { userId: driverId, model: "Test", color: "Black" },
    });
    passengerId = (
      await db.user.create({
        data: {
          name: `Options e2e passenger-${++tgSeq}`,
          telegramUserId: tgSeq,
          avatar: "",
        },
      })
    ).id;
    fromCityId = (
      await db.city.create({
        data: {
          name: `Options e2e from ${tgSeq}`,
          nameNormalized: `opt-e2e-from-${tgSeq}`,
        },
      })
    ).id;
    toCityId = (
      await db.city.create({
        data: {
          name: `Options e2e to ${tgSeq}`,
          nameNormalized: `opt-e2e-to-${tgSeq}`,
        },
      })
    ).id;
    tripIds = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const userIds = [driverId, passengerId];
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.rideRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.booking.deleteMany({ where: { tripId: { in: tripIds } } });
    await db.trip.deleteMany({ where: { id: { in: tripIds } } });
    await db.car.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.city.deleteMany({ where: { id: { in: [fromCityId, toCityId] } } });
  });

  function auth(userId: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(userId)}` };
  }

  function body(overrides: Record<string, unknown> = {}) {
    return {
      fromCity: `Options e2e from ${tgSeq}`,
      fromAddress: "ул. Отправления, 1",
      toCity: `Options e2e to ${tgSeq}`,
      toAddress: "ул. Назначения, 2",
      fromCityId,
      toCityId,
      departureAt: new Date(Date.now() + 48 * HOUR).toISOString(),
      durationMinutes: 120,
      distanceKm: 300,
      price: 700,
      seatsTotal: 3,
      tags: [],
      ...overrides,
    };
  }

  async function createTrip(overrides: Record<string, unknown> = {}) {
    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(driverId) },
      body: JSON.stringify(body(overrides)),
    });
    if (res.status !== 201) throw new Error(`create trip failed: ${res.status}`);
    const json = (await res.json()) as { id: string };
    tripIds.push(json.id);
    return json.id;
  }

  /**
   * Заявка пассажира под будущую поездку (отправление — `body()`, +48ч).
   *
   * Порядок обязателен: заявка создаётся ДО поездки, потому что уведомление
   * `ride_request_match` рассылается в момент СОЗДАНИЯ поездки. Заявка после
   * поездки не найдётся никогда, и тест проверял бы пустоту вместо гейта.
   * Окно берётся из фиксированного отправления формы, а не из строки поездки,
   * чтобы не зависеть от её id.
   */
  async function createMatchingRequest() {
    const departure = Date.now() + 48 * HOUR;
    return db.rideRequest.create({
      data: {
        userId: passengerId,
        fromCityId,
        toCityId,
        earliestAt: new Date(departure - HOUR),
        latestAt: new Date(departure + 2 * HOUR),
        expiresAt: FAR_FUTURE,
        status: "active",
      },
    });
  }

  /**
   * Пауза, за которую fire-and-forget рассылка успела бы отработать.
   *
   * Нужна НЕГАТИВНЫМ утверждениям: «сейчас записей нет» выполняется и при
   * сломанном гейте, просто потому что рассылка ещё не успела. Пауза даёт
   * записи время появиться — и только после этого её отсутствие становится
   * утверждением.
   */
  /**
   * Заявка через API, а не прямой вставкой.
   *
   * Разница принципиальна: WS-хинт шлёт только эндпоинт
   * `POST /ride-requests`. Прямой `db.rideRequest.create` путь подсказки не
   * трогает вообще, и ассерт «хинта нет» прошёл бы вхолостую.
   */
  async function publishRequestViaApi() {
    const res = await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(passengerId) },
      body: JSON.stringify({
        fromCityId,
        toCityId,
        earliestAt: new Date(Date.now() + 47 * HOUR).toISOString(),
        latestAt: new Date(Date.now() + 50 * HOUR).toISOString(),
        expiresAt: FAR_FUTURE.toISOString(),
        seats: 1,
      }),
    });
    if (res.status !== 201) throw new Error(`publish failed: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  /** WS-события, адресованные водителю (провайдер не поднимаем — шлём напрямую). */
  function spyWs() {
    const sent: string[] = [];
    vi.spyOn(wsManager, "sendToUser").mockImplementation((userId, event) => {
      if (userId === driverId) {
        sent.push(`${event.type}:${JSON.stringify(event)}`);
      }
      return 1;
    });
    return sent;
  }

  it("кейс 1+2: тело без новых полей даёт дефолты, и /trips/my их отдаёт", async () => {
    const tripId = await createTrip();

    const row = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(row.autoComplete).toBe(false);
    expect(row.matchingEnabled).toBe(true);

    // Клиент читает флаги из ответа поездки — значит они обязаны быть в
    // реальном HTTP-ответе, а не только в БД.
    const res = await app.request("/api/v1/trips/my", {
      headers: auth(driverId),
    });
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: Array<{ id: string; autoComplete: boolean; matchingEnabled: boolean }>;
    };
    const mine = page.items.find((t) => t.id === tripId);
    expect(mine?.autoComplete).toBe(false);
    expect(mine?.matchingEnabled).toBe(true);
  });

  it("кейс 5: выключенный подбор молчит В ТРЁХ каналах сразу", async () => {
    // Смысл кейса — «забыли одно из трёх мест», поэтому все три канала
    // проверяются на ОДНОЙ поездке и в порядке, который реально их
    // задевает. Порядок неочевиден и обязан быть таким:
    //
    //   заявка ДО поездки  → сработал бы канал 1 (уведомление при создании
    //                        поездки);
    //   заявка ПОСЛЕ       → сработал бы канал 3 (хинт при создании заявки).
    //
    // Если сделать обе заявки до поездки, канал 3 не сработал бы вовсе (при
    // создании заявки поездки ещё нет) и ассерт проходил бы вхолостую.
    const sent = spyWs();

    // 1. Заявка до поездки — чтобы путь уведомления был реально достижим.
    await createMatchingRequest();
    const tripId = await createTrip({ matchingEnabled: false });

    // Канал 1: ноль уведомлений о совпадении. Ждём окно, в котором запись
    // ОБЯЗАНА была бы появиться: рассылка fire-and-forget, и «пока нет
    // записи» без паузы доказывает ровно ничего (MEMORY §14).
    await settle();
    const notices = await db.notification.findMany({
      where: { userId: passengerId, type: "ride_request_match" },
    });
    expect(notices).toEqual([]);

    // 2. Заявка после поездки — чтобы путь хинта был реально достижим.
    // Именно через API: прямая вставка в БД не проходит через обработчик,
    // который шлёт хинт, и проверка была бы пустой.
    await publishRequestViaApi();
    await settle();

    // Канал 2: водитель читает пустой спрос — 200, а не 403/404.
    const demand = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(driverId),
    });
    expect(demand.status).toBe(200);
    expect((await demand.json()).items).toEqual([]);

    // Канал 3: ни одного WS-события про этот спрос.
    expect(sent.filter((line) => line.includes("ride_request"))).toEqual([]);
  });

  it("кейс 6: включённый подбор работает во всех трёх каналах", async () => {
    // Регресс на «гейт не съел обычный путь»: если выключатель где-то стоит
    // не на том месте, водитель потеряет спрос, которого ждал.
    spyWs();
    await createMatchingRequest();
    const tripId = await createTrip({ matchingEnabled: true });

    // Рассылка уведомлений fire-and-forget (`void … .catch()` в
    // trips/index.ts), поэтому ждём появления записи, а не ловим гонку.
    await vi.waitFor(async () => {
      const notices = await db.notification.findMany({
        where: { userId: passengerId, type: "ride_request_match" },
      });
      expect(notices).toHaveLength(1);
    });

    const demand = await app.request(`/api/v1/trips/${tripId}/requests`, {
      headers: auth(driverId),
    });
    expect(demand.status).toBe(200);
    expect(((await demand.json()).items as unknown[]).length).toBeGreaterThan(0);
  });

  it("кейс 3: WS-хинт приходит при публикации заявки под включённую поездку", async () => {
    // Третий канал проверяется отдельно от уведомлений: хинт шлётся при
    // СОЗДАНИИ ЗАЯВКИ и адресован водителю (обратное направление), а
    // уведомление — при создании поездки и адресовано пассажиру. Смешать их
    // в одном ассерте означало бы не проверить ни один.
    const sent = spyWs();
    const tripId = await createTrip({ matchingEnabled: true });

    await publishRequestViaApi();

    await vi.waitFor(() =>
      expect(
        sent.some(
          (line) =>
            line.includes("ride_request:new") && line.includes(tripId),
        ),
      ).toBe(true),
    );
  });

  it("кейс 7: поездка, созданная кодом без новых полей, работает как раньше", async () => {
    // Прямая вставка — так пишут сиды и e2e-фикстуры: перечисление полей
    // без флагов. Если бы флаги были обязательны в схеме без дефолта, сиды
    // сломались бы; если бы дефолт был неверным — молча поменялось бы
    // поведение всех существующих поездок.
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: `Options e2e from ${tgSeq}`,
        fromAddress: "ул. Отправления, 1",
        toCity: `Options e2e to ${tgSeq}`,
        toAddress: "ул. Назначения, 2",
        fromCityId,
        toCityId,
        departureAt: new Date(Date.now() - PENDING_BOOKING_TTL_MS - 2 * HOUR),
        durationMinutes: 120,
        distanceKm: 300,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        status: "active",
        tags: [],
      },
    });
    tripIds.push(trip.id);

    const row = await db.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(row.matchingEnabled).toBe(true);
    expect(row.autoComplete).toBe(false);

    // Дефолт TTL сохраняется: поездка ушла за сутки назад и «протухла».
    const { processExpiredTrips } = await import(
      "../../src/workers/tripWorker.js"
    );
    await processExpiredTrips();
    const after = await db.trip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    expect(after.status).toBe("completed");
  });
});
