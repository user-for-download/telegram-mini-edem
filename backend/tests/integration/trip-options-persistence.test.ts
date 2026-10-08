import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Флаги опций поездки доходят до БД и до ответа.
 *
 * Что здесь зафиксировано:
 * - POST /trips СОХРАНЯЕТ `autoComplete` и `matchingEnabled` из тела;
 * - дефолты (тело без флагов) = текущее поведение: автозавершение по TTL,
 *   подбор пассажиров включён;
 * - ОТВЕТ содержит оба флага (tripSchema требует их без `.default()` —
 *   «неизвестно» ≠ «выключено»);
 * - PATCH /trips/:id переключает оба флага (решение владельца 2026-10-08:
 *   водитель вправе передумать после публикации), и ответ отдаёт НОВОЕ
 *   значение, а не старое;
 * - PATCH БЕЗ этих ключей флаги НЕ трогает: `.partial()` без `.default()`
 *   в базе — обязательное условие, иначе PATCH цены молча сбрасывал бы опции.
 *
 * Почему это не «очевидное»: `tx.trip.create` перечисляет поля явно, а не
 * спредом `...dto`. Забытое поле уезжает в БД как дефолт схемы без ошибки:
 * водитель ставит галочку, получает 201, а опция не работает. Поэтому
 * каждое поле проверяется чтением из БД, а не только из ответа.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const HOUR = 3_600_000;

let tgSeq = 7_900_000n;

describe("опции поездки: сохранение в БД и в ответе", () => {
  let driverId: string;
  let cityA: string;
  let cityB: string;
  let tripIds: string[] = [];

  async function createUser(name: string): Promise<string> {
    const unique = `${name}-${++tgSeq}`;
    const user = await db.user.create({
      data: {
        name: unique,
        telegramUserId: tgSeq,
        avatar: "",
      },
    });
    // Автомобиль обязателен: POST /trips отдаёт 400 NO_CAR без него
    // (trips/index.ts:655). Это бизнес-правило, а не часть фичи, но без
    // машины фикстура не дойдёт до проверки флагов. Отдельной таблицей:
    // user.car — отношение has-one, вложенного create у Prisma здесь нет.
    await db.car.create({
      data: { userId: user.id, model: "Lada", color: "белый" },
    });
    return user.id;
  }

  beforeEach(async () => {
    driverId = await createUser("Options driver");
    cityA = (await db.city.create({
      data: { name: `Opt from ${tgSeq}`, nameNormalized: `opt-from-${tgSeq}` },
    })).id;
    cityB = (await db.city.create({
      data: { name: `Opt to ${tgSeq}`, nameNormalized: `opt-to-${tgSeq}` },
    })).id;
    tripIds = [];
  });

  afterEach(async () => {
    await db.notification.deleteMany({ where: { userId: driverId } });
    await db.trip.deleteMany({ where: { id: { in: tripIds } } });
    // Автомобиль — каскадом с юзером, но явная удаляющая строка не нужна:
    // car удаляется ON DELETE CASCADE, проверять это здесь не задача фичи.
    await db.user.deleteMany({ where: { id: driverId } });
    await db.city.deleteMany({ where: { id: { in: [cityA, cityB] } } });
  });

  function auth(): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(driverId)}` };
  }

  function baseBody(hoursAhead = 48): Record<string, unknown> {
    return {
      fromCity: `Opt from ${tgSeq}`,
      fromAddress: "ул. Отправления, 1",
      toCity: `Opt to ${tgSeq}`,
      toAddress: "ул. Назначения, 2",
      fromCityId: cityA,
      toCityId: cityB,
      departureAt: new Date(Date.now() + hoursAhead * HOUR).toISOString(),
      durationMinutes: 120,
      distanceKm: 300,
      price: 700,
      seatsTotal: 3,
      tags: [],
      // comment здесь НЕ задаётся: он optional-строка, а не nullable, и
      // явный null отвергается DTO (400). Клиент без комментария его не шлёт.
    };
  }

  async function createTrip(overrides: Record<string, unknown> = {}) {
    // Поездки одного водителя не пересекаются по времени (иначе 409
    // TRIP_OVERLAP — trips/index.ts проверяет диапазоны в той же
    // Serializable-транзакции), поэтому каждая получает свой отступ.
    const hoursAhead = 48 + tripIds.length * 6;
    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth() },
      body: JSON.stringify({ ...baseBody(hoursAhead), ...overrides }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    tripIds.push(body.id);
    return body;
  }

  it("опции из тела доходят до БД, а не растворяются в дефолтах схемы", async () => {
    const created = await createTrip({ autoComplete: true, matchingEnabled: false });

    const row = await db.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.autoComplete).toBe(true);
    expect(row.matchingEnabled).toBe(false);
  });

  it("тело без флагов даёт текущее поведение: TTL-автозавершение и включённый подбор", async () => {
    // Старый клиент, e2e-фикстура и сид новых полей не шлют. Дефолты обязаны
    // равняться тому, что было до фичи, иначе фича тихо ломает существующее.
    const created = await createTrip();

    const row = await db.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.autoComplete).toBe(false);
    expect(row.matchingEnabled).toBe(true);
  });

  it("ответ содержит оба флага: клиенту не нужно знать дефолты схемы", async () => {
    const created = await createTrip({ autoComplete: true, matchingEnabled: false });

    const res = await app.request(`/api/v1/trips/${created.id}`, {
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoComplete).toBe(true);
    expect(body.matchingEnabled).toBe(false);
  });

  it("PATCH переключает оба флага — водитель вправе передумать после публикации", async () => {
    const created = await createTrip({ autoComplete: false, matchingEnabled: true });

    const res = await app.request(`/api/v1/trips/${created.id}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...auth() },
      body: JSON.stringify({ autoComplete: true, matchingEnabled: false }),
    });
    expect(res.status).toBe(200);

    const row = await db.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.autoComplete).toBe(true);
    expect(row.matchingEnabled).toBe(false);
    // Ответ обязан отдать НОВОЕ значение, иначе форма покажет старое.
    const body = await res.json();
    expect(body.autoComplete).toBe(true);
    expect(body.matchingEnabled).toBe(false);
  });

  it("PATCH без флагов их НЕ трогает — PATCH цены не сбрасывает опции", async () => {
    // Регрессия класса «.default() внутри baseTripSchema»: zod 4 сохраняет
    // rung «defaulted» под .optional(), и PATCH без ключей подставлял бы
    // дефолты, МОЛЧА сбрасывая включённые опции. Дефолты живут только в
    // create-схеме — этот тест ловит их возврат в базу.
    const created = await createTrip({ autoComplete: true, matchingEnabled: true });

    const res = await app.request(`/api/v1/trips/${created.id}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...auth() },
      body: JSON.stringify({ price: 900 }),
    });
    expect(res.status).toBe(200);

    const row = await db.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.autoComplete).toBe(true);
    expect(row.matchingEnabled).toBe(true);
    expect(row.price).toBe(900);
  });

  it("не-boolean во флагах отвергается валидацией, а не тихо приводится", async () => {
    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth() },
      body: JSON.stringify({ ...baseBody(), autoComplete: "да" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH остаётся строгим: флаги не открыли дорогу мусорным полям", async () => {
    // Флаги стали полями обновления — не повод ослаблять `.strict()` на PATCH
    // (trip.dto.ts:125). Мусорное поле должно давать 400, как и раньше.
    // NB: у POST /trips `.strict()` НЕТ (создание отбрасывает лишние поля
    // молча) — это существующий контракт, менять его здесь не задача фичи.
    const created = await createTrip({ autoComplete: true, matchingEnabled: true });

    const res = await app.request(`/api/v1/trips/${created.id}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...auth() },
      body: JSON.stringify({ matchingEnabled: false, nope: 1 }),
    });
    expect(res.status).toBe(400);

    // Отвергнутый PATCH не применился частично: опция осталась прежней.
    const row = await db.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.matchingEnabled).toBe(true);
  });

  it("две поездки одного водителя несут РАЗНЫЕ опции независимо", async () => {
    // Флаги — свойство поездки, не водителя: переключение галочки не
    // должно задевать предыдущие поездки.
    const a = await createTrip({ autoComplete: true, matchingEnabled: true });
    const b = await createTrip({ autoComplete: false, matchingEnabled: false });

    const rowA = await db.trip.findUniqueOrThrow({ where: { id: a.id } });
    const rowB = await db.trip.findUniqueOrThrow({ where: { id: b.id } });
    expect([rowA.autoComplete, rowA.matchingEnabled]).toEqual([true, true]);
    expect([rowB.autoComplete, rowB.matchingEnabled]).toEqual([false, false]);
  });
});
