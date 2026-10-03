import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADMIN_TOKEN читается из env при импорте — задаём до импорта app.
vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-searchcityid";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { devMockAccessToken } = await import("../dev-mock-auth.js");

/**
 * Фильтр списка поездок по id города (`fromCityId`/`toCityId`).
 *
 * Решение владельца 2026-10-03: выбор города на всех поверхностях отдаёт id
 * справочника, и поиск фильтрует по нему, а не по подстроке имени.
 *
 * ЧТО ТЕСТ ЗАЩИЩАЕТ (и почему это не «просто ещё один параметр»):
 *   1. Точность: по id возвращается ровно та поездка, чей город выбран.
 *   2. Устранение неоднозначности подстроки — главная причина. Подстрока
 *      «Москва» матчит и «Москва-testcityid», поэтому по имени выбор не
 *      различается (такие города остаются в справочнике от старых прогонов
 *      e2e). По id — различается.
 *   3. Неизвестный id даёт пустой список, а не 400 и не «все поездки».
 *   4. Подстрочный поиск НЕ сломали: им по-прежнему можно пользоваться, когда
 *      город ещё не выбран (q, fromCity, toCity).
 *
 * Паттерны репо (trip-city-id.test.ts, city-trips-count.test.ts):
 * app.request(), dev-mock-авторизация водителя, уникальные имена городов
 * с суффиксом файла, явная уборка в afterEach.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };
const SUFFIX = "searchcityid";
/**
 * Время отправления у каждой поездки своё: у водителя не может быть двух
 * поездок с одинаковыми городами и временем (409 DUP_TRIP), а в тесте
 * нужны по две поездки рядом.
 */
let departureSeq = 0;
const departureAt = (): string => {
  departureSeq += 1;
  const day = String(1 + (departureSeq % 20)).padStart(2, "0");
  return `2031-08-${day}T10:00:00Z`;
};

async function ensureCity(name: string): Promise<string> {
  const nameNormalized = name.toLowerCase();
  const found = await db.city.findFirst({ where: { nameNormalized } });
  if (found) return found.id;
  const created = await db.city.create({ data: { name, nameNormalized } });
  return created.id;
}

let tgSeq = 9_000_000n;

async function createDriver(): Promise<string> {
  const seq = ++tgSeq;
  const user = await db.user.create({
    data: {
      name: `driver-search-${seq}`,
      telegramUserId: seq,
      avatar: "https://i.pravatar.cc/200?img=2",
    },
  });
  await db.car.create({
    data: { userId: user.id, model: "Test", color: "white", plate: `SC${seq}` },
  });
  return user.id;
}

type Created = { id: string; fromCity: string; toCity: string };

async function createTrip(
  driverId: string,
  fromCity: string,
  toCity: string,
  fromCityId: string,
  toCityId: string,
  price: number,
): Promise<Created> {
  const res = await app.request("/api/v1/trips", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${devMockAccessToken(driverId)}`,
    },
    body: JSON.stringify({
      fromCity,
      fromAddress: "Тверская 1",
      toCity,
      toAddress: "пр-т Ленина",
      fromCityId,
      toCityId,
      departureAt: departureAt(),
      durationMinutes: 130,
      distanceKm: 165,
      price,
      seatsTotal: 3,
      tags: [],
    }),
  });
  expect(res.status, `создание поездки ${fromCity}→${toCity}`).toBe(201);
  const body = (await res.json()) as Created;
  return body;
}

async function listTrips(query: string): Promise<Created[]> {
  const res = await app.request(`/api/v1/trips?${query}`, { method: "GET" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Created[] };
  return body.items;
}

describe("GET /trips: фильтр по id города", () => {
  let driverId: string;
  // «Москва» и «Москва-<суффикс>» — подстрока в обе стороны, как в бою.
  let shortCityId: string;
  let longCityId: string;
  let otherCityId: string;
  let kazanCityId: string;
  let omskCityId: string;

  beforeEach(async () => {
    driverId = await createDriver();
    shortCityId = await ensureCity(`Москва`);
    longCityId = await ensureCity(`Москва-${SUFFIX}`);
    otherCityId = await ensureCity(`Тула-${SUFFIX}`);
    kazanCityId = await ensureCity(`Казань-${SUFFIX}`);
    omskCityId = await ensureCity(`Омск-${SUFFIX}`);
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { trip: { driverId } } });
    await db.review.deleteMany({ where: { trip: { driverId } } });
    await db.trip.deleteMany({ where: { driverId } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: driverId } });
  });

  it("по fromCityId возвращает ровно свою поездку", async () => {
    const mine = await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 700);
    await createTrip(driverId, `Тула-${SUFFIX}`, `Казань-${SUFFIX}`, otherCityId, kazanCityId, 800);

    const items = await listTrips(`fromCityId=${longCityId}`);

    expect(items.map((t) => t.id)).toEqual([mine.id]);
  });

  it("подстрока различает не различает — id различает (главный довод)", async () => {
    await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 701);
    await createTrip(driverId, `Москва`, `Тула-${SUFFIX}`, shortCityId, otherCityId, 702);

    // Подстрочный поиск не может их различить: «Москва» входит в оба имени.
    const byName = await listTrips(`fromCity=Москва`);
    expect(byName).toHaveLength(2);

    // По id — ровно то, что выбрал пользователь.
    const byId = await listTrips(`fromCityId=${shortCityId}`);
    expect(byId).toHaveLength(1);
    expect(byId[0]?.fromCity).toBe(`Москва`);
  });

  it("toCityId фильтрует по городу назначения", async () => {
    const a = await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 703);
    await createTrip(driverId, `Москва-${SUFFIX}`, `Казань-${SUFFIX}`, longCityId, kazanCityId, 704);

    const items = await listTrips(`toCityId=${otherCityId}`);

    expect(items.map((t) => t.id)).toContain(a.id);
    expect(items.every((t) => t.toCity === `Тула-${SUFFIX}`)).toBe(true);
  });

  it("неизвестный id даёт пустой список, а не ошибку и не всё подряд", async () => {
    await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 705);

    const unknown = await listTrips(
      "fromCityId=00000000-0000-4000-8000-000000000000",
    );
    // Не «все поездки»: сломанный id обязан давать пусто, иначе пользователь
    // увидит поездки из городов, которых не выбирал. Этот случай поймал тест
    // на первой версии реализации — там неизвестный id просто не добавлял
    // фильтр, и прилетало 20 поездок вместо нуля.
    expect(unknown).toHaveLength(0);
  });

  it("при противоречивом вводе приоритет у id, а не у имени", async () => {
    await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 708);
    await createTrip(driverId, `Москва`, `Тула-${SUFFIX}`, shortCityId, otherCityId, 709);

    const res = await app.request(
      "/api/v1/trips?fromCity=Москва&fromCityId=00000000-0000-4000-8000-000000000000",
      { method: "GET" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Created[] };

    // Имя «Москва» само по себе матчило бы 2 поездки, но id выбранного города
    // невалиден → показывать поездки по имени нельзя: пользователь выбрал
    // конкретный город, а не «всё похожее». Пусто честнее.
    expect(body.items).toHaveLength(0);
  });

  it("без id подстрочный поиск продолжает работать", async () => {
    await createTrip(driverId, `Москва-${SUFFIX}`, `Тула-${SUFFIX}`, longCityId, otherCityId, 706);
    await createTrip(driverId, `Казань-${SUFFIX}`, `Омск-${SUFFIX}`, kazanCityId, omskCityId, 707);

    const items = await listTrips(`fromCity=Казань-${SUFFIX}`);

    expect(items).toHaveLength(1);
    expect(items[0]?.fromCity).toBe(`Казань-${SUFFIX}`);
  });

});
