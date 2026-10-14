import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";

/**
 * Регрессы фильтров публичного списка поездок (GET /trips):
 * - LIKE-джокеры из пользовательского ввода не должны «проваливать» фильтр
 *   (`q=%` раньше матчил все поездки);
 * - невалидные dateFrom/dateTo и мусорный maxPrice должны давать 400,
 *   а не молча игнорироваться/приниматься (parseInt("100abc") → 100).
 *
 * Паттерн репо: реальная БД, прямые фикстуры, явная уборка.
 */
describe("GET /trips — search filters", () => {
  let driverId: string;
  let tripId: string;
  const createdUserIds: string[] = [];
  let tgSeq = 8_100_000n;

  beforeEach(async () => {
    const driver = await db.user.create({
      data: {
        name: `FilterDriver-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "",
      },
    });
    driverId = driver.id;
    createdUserIds.push(driver.id);

    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва-фильтр",
        fromAddress: "A",
        toCity: "Тула-фильтр",
        toAddress: "B",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 120,
        distanceKm: 180,
        price: 700,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
  });

  afterEach(async () => {
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  const list = async (query: string) => {
    const res = await app.request(`/api/v1/trips?limit=50&${query}`);
    return { status: res.status, body: (await res.json()) as { items: Array<{ id: string }> } };
  };

  const ids = (body: { items: Array<{ id: string }> }) =>
    body.items.map((t) => t.id);

  it("q=% трактуется буквально, а не как «все поездки»", async () => {
    const { status, body } = await list("q=%25");
    expect(status).toBe(200);
    expect(ids(body)).not.toContain(tripId);
  });

  it("q=_ трактуется буквально, а не как одиночный джокер", async () => {
    const { status, body } = await list("q=_");
    expect(status).toBe(200);
    expect(ids(body)).not.toContain(tripId);
  });

  it("обычная подстрока по-прежнему матчится", async () => {
    const { status, body } = await list("q=" + encodeURIComponent("Москва"));
    expect(status).toBe(200);
    expect(ids(body)).toContain(tripId);
  });

  it("невалидный dateFrom → 400", async () => {
    const { status } = await list("dateFrom=not-a-date");
    expect(status).toBe(400);
  });

  it("невалидный dateTo → 400", async () => {
    const { status } = await list("dateTo=2026-13-45");
    expect(status).toBe(400);
  });

  it("maxPrice с мусорным хвостом → 400", async () => {
    const { status } = await list("maxPrice=100abc");
    expect(status).toBe(400);
  });

  it("maxPrice выше потолка цены поездки → 400", async () => {
    const { status } = await list("maxPrice=100001");
    expect(status).toBe(400);
  });

  it("корректный maxPrice принимается и фильтрует", async () => {
    const { status, body } = await list("maxPrice=1000");
    expect(status).toBe(200);
    expect(ids(body)).toContain(tripId);
  });
});
