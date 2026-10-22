import { z } from "zod";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Длина имени города в справочнике. Совпадает с Trip.fromCity/toCity. */
export const CITY_NAME_MAX_LENGTH = 100;
/** Длина поискового запроса для автодополнения. */
export const CITY_SUGGEST_QUERY_MAX_LENGTH = 100;
/** Жёсткий лимит на размер ответа suggest (UI не покажет больше). */
export const CITY_SUGGEST_LIMIT_MAX = 100;
/** Дефолт для suggest (UI догружает при скролле, но мы выдаём сразу пачку). */
export const CITY_SUGGEST_LIMIT_DEFAULT = 100;
/** Размер страницы в админ-списке городов. */
export const ADMIN_CITY_PAGE_SIZE_DEFAULT = 50;
/** Максимальный pageSize для админ-списка городов. */
export const ADMIN_CITY_PAGE_SIZE_MAX = 200;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Coerces a positive integer query param with a default and an upper bound.
 * Same shape as `positiveIntQuery` in admin.schema.ts, but kept local so
 * the city module has no hidden dependency on admin schemas.
 */
const positiveIntQuery = (def: number, max: number) =>
  z.coerce.number().int().positive().max(max).default(def);

/**
 * Trim + collapse internal whitespace. Серверная нормализация для имени
 * города. Совпадает с `normalizeCityName` в prisma/seed.ts.
 */
export const normalizeCityName = (raw: string): string =>
  raw.trim().replace(/\s+/g, " ");

/**
 * Lowercased normalized name (used for case-insensitive uniqueness and
 * search). Mirrors the SQL column `City.nameNormalized`.
 */
export const cityNameNormalized = (raw: string): string =>
  normalizeCityName(raw).toLowerCase();

// ─── Entity DTOs ───────────────────────────────────────────────────────────

/** Снимок города для UI (мини-апп + webapp). */
export const cityDtoSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(CITY_NAME_MAX_LENGTH),
});
export type CityDto = z.infer<typeof cityDtoSchema>;

/** DTO для админ-панели: включает tripsCount и временные метки. */
export const adminCityDtoSchema = cityDtoSchema.extend({
  tripsCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminCityDto = z.infer<typeof adminCityDtoSchema>;

// ─── Body / Query Schemas ──────────────────────────────────────────────────

/**
 * Тело POST /admin/cities и PATCH /admin/cities/:id. Имя проходит через
 * trim + collapse-whitespace в `.transform`. Лишние поля запрещены.
 */
export const cityNameBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Имя города не может быть пустым")
      .max(CITY_NAME_MAX_LENGTH, `Максимум ${CITY_NAME_MAX_LENGTH} символов`)
      .transform(normalizeCityName)
      .refine((v) => v.length > 0, "Имя города не может быть пустым"),
  })
  .strict();

export type CityNameBody = z.infer<typeof cityNameBodySchema>;

/** GET /api/v1/cities/suggest?q=…&limit=… — публичный, для автодополнения. */
export const citySuggestQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(CITY_SUGGEST_QUERY_MAX_LENGTH)
      .optional(),
    limit: positiveIntQuery(CITY_SUGGEST_LIMIT_DEFAULT, CITY_SUGGEST_LIMIT_MAX),
  })
  .strict();

export type CitySuggestQuery = z.infer<typeof citySuggestQuerySchema>;

/** GET /api/v1/admin/cities?q=…&page=…&pageSize=… — админ-список. */
export const adminCitiesQuerySchema = z
  .object({
    q: z.string().trim().max(CITY_SUGGEST_QUERY_MAX_LENGTH).optional(),
    page: positiveIntQuery(1, 10_000),
    pageSize: positiveIntQuery(
      ADMIN_CITY_PAGE_SIZE_DEFAULT,
      ADMIN_CITY_PAGE_SIZE_MAX,
    ),
  })
  .strict();

export type AdminCitiesQuery = z.infer<typeof adminCitiesQuerySchema>;

// ─── Response Schemas ──────────────────────────────────────────────────────

export const citySuggestResponseSchema = z.object({
  items: z.array(cityDtoSchema),
});
export type CitySuggestResponse = z.infer<typeof citySuggestResponseSchema>;

export const paginatedCitiesResponseSchema = z.object({
  items: z.array(adminCityDtoSchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasMore: z.boolean(),
  }),
});
export type PaginatedCitiesResponse = z.infer<
  typeof paginatedCitiesResponseSchema
>;

/** POST /api/v1/admin/cities/recompute-trips-count — результат пересчёта. */
export const recomputeCityTripsCountResponseSchema = z
  .object({
    ok: z.literal(true),
    updated: z.number().int().nonnegative(),
  })
  .strict();
export type RecomputeCityTripsCountResponse = z.infer<
  typeof recomputeCityTripsCountResponseSchema
>;
