import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Третий юзер для кейсов про агрегацию: лента читается от userId, поэтому
 *  «второго человека» нельзя делать его же заявками — они исключены.
 *
 *  Кладём id в `extraUserIds`: если кейс упадёт ДО своего delete, заявки
 *  третьего юзера утекли бы в следующие тесты файла (лента читает всех, кроме
 *  читателя) и ломали бы их неожиданным количеством строк. */
const extraUserIds: string[] = [];
const extraCityIds: string[] = [];

/** Третий город для маршрутов: ассоциируется с заявками (Restrict), поэтому
 *  удалять его можно только после их удаления — общий afterEach и делает это
 *  в правильном порядке (заявки → юзеры → города). */
async function createThirdCity(suffix: number): Promise<string> {
  const city = await db.city.create({
    data: {
      name: `Third ${suffix}`,
      nameNormalized: `third-${suffix}`,
    },
  });
  extraCityIds.push(city.id);
  return city.id;
}
async function createThirdUser(suffix: number): Promise<string> {
  const user = await db.user.create({
    data: {
      name: `Third rider ${suffix}`,
      telegramUserId: BigInt(4300001 + (suffix % 100000)),
      avatar: "",
    },
  });
  extraUserIds.push(user.id);
  return user.id;
}

describe("RideRequest API", () => {
  let userId: string;
  let otherUserId: string;
  let suffixUser: number;
  let fromCityId: string;
  let toCityId: string;

  beforeEach(async () => {
    const suffix = Date.now();
    suffixUser = suffix;
    fromCityId = randomUUID();
    toCityId = randomUUID();
    const users = await Promise.all([
      db.user.create({ data: { name: `Ride requester ${suffix}`, telegramUserId: BigInt(4100001 + (suffix % 100000)), avatar: "" } }),
      db.user.create({ data: { name: `Ride driver ${suffix}`, telegramUserId: BigInt(4200001 + (suffix % 100000)), avatar: "" } }),
    ]);
    userId = users[0].id;
    otherUserId = users[1].id;
    await db.city.createMany({
      data: [
        { id: fromCityId, name: `From ${suffix}`, nameNormalized: `from-${suffix}` },
        { id: toCityId, name: `To ${suffix}`, nameNormalized: `to-${suffix}` },
      ],
    });
  });

  afterEach(async () => {
    const allUserIds = [userId, otherUserId, ...extraUserIds.splice(0)];
    const allCityIds = [fromCityId, toCityId, ...extraCityIds.splice(0)];
    // Порядок обязателен: заявки ссылаются и на юзеров, и на города (Restrict).
    await db.rideRequest.deleteMany({ where: { userId: { in: allUserIds } } });
    await db.user.deleteMany({ where: { id: { in: allUserIds } } });
    await db.city.deleteMany({ where: { id: { in: allCityIds } } });
  });

  function auth(user: string): Record<string, string> {
    return { Authorization: `Bearer ${devMockAccessToken(user)}` };
  }

  it("creates, lists and cancels an owned request", async () => {
    const create = await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(userId) },
      body: JSON.stringify({
        fromCityId,
        toCityId,
        earliestAt: "2030-01-01T09:00:00.000Z",
        latestAt: "2030-01-01T12:00:00.000Z",
        expiresAt: "2030-01-02T00:00:00.000Z",
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.seats).toBe(1);
    expect(created.fromCity.id).toBe(fromCityId);

    const list = await app.request("/api/v1/ride-requests", { headers: auth(userId) });
    expect(list.status).toBe(200);
    expect((await list.json()).items).toHaveLength(1);

    const remove = await app.request(`/api/v1/ride-requests/${created.id}`, {
      method: "DELETE",
      headers: auth(userId),
    });
    expect(remove.status).toBe(200);
    expect((await remove.json()).status).toBe("cancelled");
  });

  it("returns only matching requests to another user", async () => {
    const create = await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(userId) },
      body: JSON.stringify({ fromCityId, toCityId, earliestAt: "2030-01-01T09:00:00.000Z", latestAt: "2030-01-01T12:00:00.000Z", expiresAt: "2030-01-02T00:00:00.000Z" }),
    });
    const request = await create.json();
    const matching = await app.request(`/api/v1/ride-requests/matching?fromCityId=${fromCityId}&toCityId=${toCityId}&earliestAt=2030-01-01T10:00:00.000Z&latestAt=2030-01-01T11:00:00.000Z`, { headers: auth(otherUserId) });
    expect(matching.status).toBe(200);
    expect((await matching.json()).items.map((item: { id: string }) => item.id)).toContain(request.id);
  });

  it("rejects terminal status changes and more than three active requests", async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await app.request("/api/v1/ride-requests", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...auth(userId) },
        body: JSON.stringify({ fromCityId, toCityId, earliestAt: "2030-01-01T09:00:00.000Z", latestAt: "2030-01-01T12:00:00.000Z", expiresAt: "2030-01-02T00:00:00.000Z" }),
      });
      expect(response.status).toBe(201);
    }
    const overLimit = await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(userId) },
      body: JSON.stringify({ fromCityId, toCityId, earliestAt: "2030-01-01T09:00:00.000Z", latestAt: "2030-01-01T12:00:00.000Z", expiresAt: "2030-01-02T00:00:00.000Z" }),
    });
    expect(overLimit.status).toBe(409);
  });
  it("feed: суммаризатор — по маршрутам, люди и места считаются по-разному", async () => {
    const at = (day: number, hour: number) =>
      new Date(Date.UTC(2035, 0, day, hour)).toISOString();
    const thirdCityId = await createThirdCity(suffixUser);

    // Один человек с ДВУМЯ заявками на один маршрут: людей 1, мест сумма.
    // Активных заявок у человека до трёх, и count(distinct) через Set — то,
    // что не даёт превратить одного человека в «2 человека».
    for (const [earliest, latest, seats] of [
      [at(2, 9), at(2, 20), 1],
      [at(3, 9), at(3, 20), 2],
    ] as const) {
      const response = await app.request("/api/v1/ride-requests", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...auth(otherUserId) },
        body: JSON.stringify({
          fromCityId,
          toCityId,
          earliestAt: earliest,
          latestAt: latest,
          expiresAt: latest,
          seats,
        }),
      });
      expect(response.status).toBe(201);
    }
    // Второй человек на тот же маршрут: людей 2, мест 4. Это ТРЕТИЙ юзер —
    // лента читается от userId, и его собственные заявки исключены.
    const thirdUserId = await createThirdUser(suffixUser);
    await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(thirdUserId) },
      body: JSON.stringify({
        fromCityId,
        toCityId,
        earliestAt: at(4, 9),
        latestAt: at(4, 20),
        expiresAt: at(4, 23),
        seats: 1,
      }),
    });
    // Своя заявка (от того, кто читает ленту) — в ленту не попадает.
    await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(userId) },
      body: JSON.stringify({
        fromCityId: fromCityId,
        toCityId: thirdCityId,
        earliestAt: at(1, 9),
        latestAt: at(1, 20),
        expiresAt: at(1, 23),
        seats: 3,
      }),
    });

    const feed = await app.request("/api/v1/ride-requests/feed", {
      headers: auth(userId),
    });
    expect(feed.status).toBe(200);
    const items = (
      await feed.json()
    ).items as Array<{
      fromCity: { id: string };
      toCity: { id: string };
      people: number;
      seats: number;
      nextAt: string;
    }>;

    // Своя заявка исключена, остаётся один агрегат.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      fromCity: { id: fromCityId },
      toCity: { id: toCityId },
      people: 2, // два разных человека, не три заявки
      seats: 4, // 1 + 2 + 1
    });
    // nextAt — ближайшее начало окна, а не последнее созданное.
    expect(items[0]?.nextAt).toBe(at(2, 9));
    // Автора в агрегате нет: лента анонимная.
    expect(JSON.stringify(items[0])).not.toContain(otherUserId);

  });

  it("feed: сортировка по спросу, затем по ближайшему окну", async () => {
    const at = (day: number, hour: number) =>
      new Date(Date.UTC(2035, 0, day, hour)).toISOString();
    const post = async (
      who: string,
      toCity: string,
      day: number,
      seats: number,
    ): Promise<void> => {
      const response = await app.request("/api/v1/ride-requests", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...auth(who) },
        body: JSON.stringify({
          fromCityId,
          toCityId: toCity,
          earliestAt: at(day, 9),
          latestAt: at(day, 20),
          expiresAt: at(day, 23),
          seats,
        }),
      });
      expect(response.status).toBe(201);
    };

    const thirdCityId = await createThirdCity(suffixUser);

    // Маршрут A: 1 место, но скоро (раньше). Маршрут B: 3 места, позже.
    // Маршрут C: 3 места, ещё позже — делит спрос с B, решает дата.
    const thirdUserId = await createThirdUser(suffixUser);
    await post(otherUserId, toCityId, 2, 1);
    await post(otherUserId, thirdCityId, 6, 3);
    await post(thirdUserId, thirdCityId, 3, 3);

    const feed = await app.request("/api/v1/ride-requests/feed", {
      headers: auth(userId),
    });
    const items = (
      await feed.json()
    ).items as Array<{ toCity: { id: string }; seats: number }>;

    const routes = items.map((item) => `${item.toCity.id}:${item.seats}`);
    // Спрос выше — раньше; при равном спросе решает ближайшее окно.
    expect(routes[0]).toBe(`${thirdCityId}:6`);
    expect(routes[1]).toBe(`${toCityId}:1`);
    expect(items[0]?.seats).toBe(6);

  });

  it("feed: просроченное не агрегируется, limit валидируется", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await app.request("/api/v1/ride-requests", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...auth(otherUserId) },
      body: JSON.stringify({
        fromCityId,
        toCityId,
        earliestAt: past,
        latestAt: past,
        expiresAt: past,
      }),
    });

    const feed = await app.request("/api/v1/ride-requests/feed", {
      headers: auth(userId),
    });
    expect(feed.status).toBe(200);
    expect((await feed.json()).items).toHaveLength(0);

    const bad = await app.request("/api/v1/ride-requests/feed?limit=0", {
      headers: auth(userId),
    });
    expect(bad.status).toBe(400);
    const tooBig = await app.request("/api/v1/ride-requests/feed?limit=999", {
      headers: auth(userId),
    });
    expect(tooBig.status).toBe(400);
  });
});
