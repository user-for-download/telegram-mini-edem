// backend/src/cities/index.ts
//
// Публичный справочник точек: используется мини-апом для автодополнения
// при создании/редактировании поездки. Без авторизации (мини-апп сам
// открывает поиск), с IP-ограничением.
import { Hono } from "hono";
import {
  citySuggestQuerySchema,
  citySuggestResponseSchema,
} from "@edem/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { devRateMax } from "../env.js";
import { sanitizeValue } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { escapeLike } from "../utils/like.js";
import { serializeCity } from "./serializers.js";

export const citiesRouter = new Hono();

/**
 * Лимит на автодополнение: 30 запросов в минуту с одного IP.
 * Достаточно для активного набора, но отбивает агрессивный скрейпинг.
 */
const suggestLimiter = createRateLimiter({
  windowMs: 60_000,
  max: devRateMax(30),
  keyPrefix: "cities-suggest",
});

/**
 * GET /api/v1/cities/suggest?q=…&limit=…
 *
 * Серверная фильтрация по подстроке (case-insensitive). Поиск
 * использует `mode: "insensitive"` (PostgreSQL ILIKE): для 25–200
 * городов это O(N) с индексом на `name` и без проблем.
 */
citiesRouter.get("/suggest", suggestLimiter, async (c) => {
  const raw = sanitizeValue(c.req.query());
  const parsed = citySuggestQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid query" },
      400,
    );
  }

  const { q, limit } = parsed.data;
  // Пустая подстрока (включая undefined) → возвращаем весь справочник.
  // Не строим where, чтобы Prisma не генерировал `name: { contains: "" }`
  // с лишним ILIKE.
  const where: Prisma.CityWhereInput | undefined = q
    ? { name: { contains: escapeLike(q), mode: "insensitive" } }
    : undefined;

  const cities = await db.city.findMany({
    ...(where ? { where } : {}),
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true },
  });

  const payload = citySuggestResponseSchema.parse({
    items: cities.map(serializeCity),
  });

  return c.json(payload, 200);
});
