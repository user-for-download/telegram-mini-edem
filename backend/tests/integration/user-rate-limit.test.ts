import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * User-based rate limits: лимит на создание поездок — 10 в сутки на
 * пользователя (createTripLimiter). 11-я поездка → 429 RATE_LIMITED
 * с retryAfterMs в теле и Retry-After заголовке.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Получить id города из справочника, создав при отсутствии. Нужен
 * тестам, которые создают поездки через API (DTO требует
 * fromCityId/toCityId — справочник обязателен).
 */
async function ensureCity(name: string): Promise<string> {
  const nameNormalized = name.trim().toLowerCase();
  const existing = await db.city.findFirst({ where: { nameNormalized } });
  if (existing) return existing.id;
  const created = await db.city.create({ data: { name, nameNormalized } });
  return created.id;
}

describe("User-based rate limits (create trip)", () => {
  let tgSeq = 5_300_000n;
  let driverId: string;
  const createdTripIds: string[] = [];

  beforeEach(async () => {
    for (;;) {
      try {
        const user = await db.user.create({
          data: {
            name: `RateLimitDriver-${Date.now()}`,
            telegramUserId: ++tgSeq,
            avatar: "https://i.pravatar.cc/200?img=9",
          },
        });
        driverId = user.id;
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }

    await db.car.create({
      data: {
        userId: driverId,
        model: "Tesla",
        color: "red",
        plate: `RL${tgSeq}`,
      },
    });
  });

  afterEach(async () => {
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    await db.car.deleteMany({ where: { userId: driverId } });
    await db.user.deleteMany({ where: { id: driverId } });
    createdTripIds.length = 0;
  });

  async function createTrip(index: number): Promise<{ status: number; body: unknown }> {
    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(driverId)}`,
      },
      // Непересекающиеся времена: 10:00, 12:00, 14:00... (длительность 60 мин)
      body: JSON.stringify({
        fromCity: "Москва",
        fromAddress: "Тверская 1",
        toCity: "СПб",
        toAddress: "Невский 1",
        fromCityId: await ensureCity("Москва"),
        toCityId: await ensureCity("СПб"),
        departureAt: new Date(Date.UTC(2030, 7, 1, 10 + index * 2)).toISOString(),
        durationMinutes: 60,
        distanceKm: 700,
        price: 2000,
        seatsTotal: 3,
        tags: [],
      }),
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it("11-я поездка за сутки отклоняется с 429 RATE_LIMITED", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await createTrip(i);
      expect(res.status).toBe(201);
      createdTripIds.push(res.body.id);
    }

    const eleventh = await createTrip(10);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe("RATE_LIMITED");
    expect(typeof eleventh.body.retryAfterMs).toBe("number");
    expect(eleventh.body.retryAfterMs).toBeGreaterThan(0);
  });

  it("другой пользователь не попадает под лимит первого", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await createTrip(i);
      expect(res.status).toBe(201);
      createdTripIds.push(res.body.id);
    }

    // Новый пользователь — лимит первого на него не распространяется.
    const other = await db.user.create({
      data: {
        name: `RateLimitOther-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=9",
      },
    });
    await db.car.create({
      data: {
        userId: other.id,
        model: "Tesla",
        color: "blue",
        plate: `RL${tgSeq + 1n}`,
      },
    });

    const res = await app.request("/api/v1/trips", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${devMockAccessToken(other.id)}`,
      },
      body: JSON.stringify({
        fromCity: "Москва",
        fromAddress: "Тверская 1",
        toCity: "СПб",
        toAddress: "Невский 1",
        fromCityId: await ensureCity("Москва"),
        toCityId: await ensureCity("СПб"),
        departureAt: "2030-08-01T10:00:00Z",
        durationMinutes: 60,
        distanceKm: 700,
        price: 2000,
        seatsTotal: 3,
        tags: [],
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);

    await db.trip.deleteMany({ where: { id: body.id } });
    await db.car.deleteMany({ where: { userId: other.id } });
    await db.user.deleteMany({ where: { id: other.id } });
  });
});
