import { z } from "zod";
import { tripTagSchema, tripSchema, MAX_SEATS } from "../schemas/trip.schema.js";

/**
 * Базовый объект без refine.
 * От него отдельно берутся .partial() (для обновления) и .refine() (для обоих вариантов).
 * Это критично: .refine() возвращает ZodEffects, у которого нет метода .partial().
 *
 * `fromCity`/`toCity` — строки-снимки (историческое имя для UI/поиска/
 * уведомлений). `fromCityId`/`toCityId` — FK на справочник City. Без
 * пары id-ов сервер отвергает поездку (autocomplete UI не позволяет
 * ввести город вручную — только выбор из справочника).
 */
/**
 * Экспортируется для тестов/валидаторов, которым нужно отдельное поле
 * контракта (у refined createTripDtoSchema нет .shape): например,
 * сид-тест проверяет seedCityId против .shape.fromCityId.
 */
export const baseTripSchema = z.object({
  fromCity: z.string().min(1).max(100),
  fromAddress: z.string().max(200),
  toCity: z.string().min(1).max(100),
  toAddress: z.string().max(200),
  fromCityId: z.string().uuid(),
  toCityId: z.string().uuid(),
  departureAt: z.string().datetime(),
  // Верхние границы — зеркало клиентской валидации мини-апа
  // (CreateTripModal/validation.ts): время в пути не более 7 суток
  // (водитель вводит часы 1..168, в API уходит durationMinutes = часы × 60),
  // расстояние не более 20000 км. Без max oversize-пayload проходил DTO
  // и упирался в БД/переполнение интервалов (security-audit §2: bounds
  // on both ends). seatsTotal намеренно НЕ трогаем (MAX_SEATS=3, F1).
  durationMinutes: z.number().int().positive().max(7 * 24 * 60),
  distanceKm: z.number().positive().max(20000),
  price: z.number().int().positive().max(100000),
  seatsTotal: z.number().int().min(1).max(MAX_SEATS),
  tags: z.array(tripTagSchema).max(6),
  comment: z.string().max(500).optional(),
});

export const createTripDtoSchema = baseTripSchema.refine(
  (data) =>
    data.fromCity.trim().toLowerCase() !== data.toCity.trim().toLowerCase(),
  {
    message: "Города отправления и назначения совпадают",
    path: ["toCity"],
  },
).refine(
  (data) => data.fromCityId !== data.toCityId,
  {
    message: "Города отправления и назначения совпадают",
    path: ["toCityId"],
  },
);

export type CreateTripDto = z.infer<typeof createTripDtoSchema>;

export const tripFiltersDtoSchema = z.object({
  // Полнотекстовый поиск по городам/адресам (backend: trips GET /).
  q: z.string().max(100).optional(),
  // Подстрочный фильтр по имени — остаётся для случая «город ещё не выбран».
  fromCity: z.string().optional(),
  toCity: z.string().optional(),
  // Точный фильтр по справочнику (решение владельца 2026-10-03). Выбор города
  // на всех поверхностях отдаёт id, поэтому поиск фильтрует по нему: имя
  // неоднозначно («Москва» входит в «Москва-…», такие города остаются в
  // справочнике от старых прогонов e2e). При обоих параметрах приоритет у id.
  fromCityId: z.string().uuid().optional(),
  toCityId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  tags: z.array(tripTagSchema).optional(),
  maxPrice: z.number().int().positive().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type TripFiltersDto = z.infer<typeof tripFiltersDtoSchema>;

/**
 * PATCH /trips/:id: маршрут (`fromCity`/`fromCityId`/`toCity`/`toCityId`)
 * ЗАПРЕЩЁН к изменению. Водитель не может подменить направление после
 * публикации, чтобы не обманывать уже подтверждённых пассажиров
 * (см. `EditTripModal`: «Удалить поездку» — единственный способ сменить
 * маршрут). Бэкенд и UI зеркалят это правило.
 *
 * `.strict()` гарантирует, что Zod не «проглотит» запрещённые поля
 * (по умолчанию Zod их просто отбрасывает — а нам нужен 400).
 */
export const updateTripDtoSchema = baseTripSchema
  .partial()
  .omit({ fromCity: true, fromCityId: true, toCity: true, toCityId: true })
  .strict();

export type UpdateTripDto = z.infer<typeof updateTripDtoSchema>;

export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
});

export const paginatedTripsResponseSchema = z.object({
  items: z.array(tripSchema),
  pagination: paginationSchema,
});

export type PaginatedTripsResponse = z.infer<typeof paginatedTripsResponseSchema>;
