// backend/tests/fixtures/telegram.ts
//
// Общие фикстуры Telegram-parity сьюта (tg-migration-16): сиды
// TG-пользователей, городов, авторизация (dev-initData login через реальный
// /auth/telegram + mock-токены для остального), админ-кука, уникальные IP
// под TRUST_PROXY и идемпотентная чистка изолированных данных.
//
// Диапазоны идентификаторов не пересекаются с другими сьютами:
// telegramUserId — BigInt 9_940_000+, уникален на файл.
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

export const JSON_HEADERS = { "Content-Type": "application/json" };

let tgSeq = 9_940_000n;
let ipSeq = 0;

const createdUserIds: string[] = [];
const createdTripIds: string[] = [];
const createdCityIds: string[] = [];

/** Свежий telegramUserId для теста. */
export function nextTelegramId(): bigint {
  tgSeq += 1n;
  return tgSeq;
}

/** Уникальный IP под режим доверенного прокси (обход IP-лимитеров). */
export function uniqueIp(): string {
  ipSeq += 1;
  return `10.94.0.${(ipSeq % 250) + 1}`;
}

export function ipHeaders(ip: string): Record<string, string> {
  return { "X-Real-IP": ip };
}

/** TG-пользователь напрямую в БД (быстрый сид, без login-флоу). */
export async function seedTelegramUser(
  data: Record<string, unknown> = {},
): Promise<{ id: string; tgId: bigint }> {
  const tgId = nextTelegramId();
  const user = await db.user.create({
    data: {
      telegramUserId: tgId,
      name: `TgParity-${tgId}`,
      avatar: "https://t.me/i/userpic/320/seed.svg",
      ...data,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgId };
}

let citySeq = 0;

/**
 * Город справочника (для POST /trips нужен FK fromCityId/toCityId).
 * Сервер сверяет пару имя↔ID по nameNormalized, поэтому имя и нормализованная
 * форма строго консистентны; уникальность — суффиксом в обоих полях.
 */
export async function seedCity(base: string): Promise<{ id: string; name: string }> {
  citySeq += 1;
  const name = `${base}-${citySeq}`;
  const city = await db.city.create({
    data: { name, nameNormalized: name.trim().toLowerCase() },
  });
  createdCityIds.push(city.id);
  return { id: city.id, name };
}

/** Заголовки авторизации пользователя (dev mock-токен + IP). */
export function authHeaders(userId: string, ip: string): Record<string, string> {
  return {
    Authorization: `Bearer ${devMockAccessToken(userId)}`,
    ...ipHeaders(ip),
  };
}

/** Dev-initData формата dev-bypass (hash=dev-hash, ALLOW_DEV_AUTH под vitest). */
export function devInitData(
  user: Record<string, unknown>,
  hash = "dev-hash",
): string {
  return new URLSearchParams([
    ["user", JSON.stringify(user)],
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["hash", hash],
  ]).toString();
}

export interface TelegramLogin {
  userId: string;
  accessToken: string;
}

/**
 * Полный вход через реальный POST /api/v1/auth/telegram.
 * Возвращает userId + accessToken для дальнейших вызовов.
 */
export async function telegramLogin(
  app: { request: (url: string, init?: RequestInit) => Promise<Response> },
  tgId: bigint,
  firstName = "Паритет",
): Promise<TelegramLogin> {
  const res = await app.request("/api/v1/auth/telegram", {
    method: "POST",
    headers: { ...JSON_HEADERS, ...ipHeaders(uniqueIp()) },
    body: JSON.stringify({
      initData: devInitData({ id: Number(tgId), first_name: firstName }),
    }),
  });
  if (res.status !== 200) {
    throw new Error(`telegram login failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    accessToken: string;
    user: { id: string };
  };
  createdUserIds.push(body.user.id);
  return { userId: body.user.id, accessToken: body.accessToken };
}

/** Админ-кука edem_admin_jwt через POST /admin/auth/login. */
export async function adminLogin(
  app: { request: (url: string, init?: RequestInit) => Promise<Response> },
  token: string,
): Promise<string> {
  const res = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { ...JSON_HEADERS, ...ipHeaders(uniqueIp()) },
    body: JSON.stringify({ token }),
  });
  const setCookie = res.headers.get("set-cookie");
  const match = /edem_admin_jwt=([^;]+)/.exec(setCookie ?? "");
  if (!match) throw new Error("admin login did not set cookie");
  return `edem_admin_jwt=${match[1]}`;
}

/** Машина водителя (без неё POST /trips отвечает 400 NO_CAR). */
export async function seedCar(
  userId: string,
  data: Record<string, unknown> = {},
): Promise<string> {
  const car = await db.car.create({
    data: { userId, model: "Lada Vesta", color: "белый", ...data },
  });
  return car.id;
}

/** Поездка напрямую в БД (стабильный сид для не-AUTH путей). */
export async function seedTrip(
  driverId: string,
  data: Record<string, unknown> = {},
): Promise<string> {
  const trip = await db.trip.create({
    data: {
      driverId,
      fromCity: "Москва",
      fromAddress: "м. Тёплый Стан",
      toCity: "Тула",
      toAddress: "пр-т Ленина",
      departureAt: new Date("2030-06-01T09:00:00Z"),
      durationMinutes: 150,
      distanceKm: 180,
      price: 500,
      seatsTotal: 3,
      seatsAvailable: 3,
      tags: [],
      ...data,
    },
  });
  createdTripIds.push(trip.id);
  return trip.id;
}

export function trackTrip(tripId: string): void {
  createdTripIds.push(tripId);
}

/**
 * Идемпотентная чистка изолированных данных сьюта (порядок — от
 * детей к родителям по FK). Уже удалённые строки — не ошибка.
 */
export async function cleanupTelegramFixtures(): Promise<void> {
  if (createdUserIds.length > 0) {
    await db.booking.deleteMany({
      where: {
        OR: [
          { passengerId: { in: createdUserIds } },
          { tripId: { in: createdTripIds } },
        ],
      },
    });
    await db.review.deleteMany({
      where: {
        OR: [
          { authorId: { in: createdUserIds } },
          { targetUserId: { in: createdUserIds } },
        ],
      },
    });
    await db.report.deleteMany({
      where: { reporterId: { in: createdUserIds } },
    });
    await db.feedback.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await db.notification.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await db.refreshToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await db.car.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
  }
  if (createdTripIds.length > 0) {
    await db.trip.deleteMany({ where: { id: { in: createdTripIds } } });
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCityIds.length > 0) {
    await db.city.deleteMany({ where: { id: { in: createdCityIds } } });
  }
  createdUserIds.length = 0;
  createdTripIds.length = 0;
  createdCityIds.length = 0;
}
