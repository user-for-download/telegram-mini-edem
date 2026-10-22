import { apiGet, apiPatch } from "@/lib/api-client";
import {
  adminPaginatedTripsSchema,
  adminTripDetailDtoSchema,
  adminTripDtoSchema,
  type AdminPaginatedTrips,
  type AdminTripDetailDto,
  type AdminTripDto,
  type AdminTripsQuery,
  type TripStatus,
} from "@edem/contracts";

export type { TripStatus };

export type FetchTripsParams = AdminTripsQuery;

/**
 * Query-строка списка поездок. Активные фильтры попадают в запрос,
 * пустые/пробельные — опускаются: отсутствие параметра бэкенд трактует
 * как «фильтр не задан» (см. adminTripsQuerySchema).
 *
 * Вынесено в чистую функцию, чтобы поведение фильтров покрывалось
 * node-тестами без DOM (webapp/vitest.config.ts).
 */
export function buildTripsSearchParams(
  params: AdminTripsQuery,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });

  const setIfPresent = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      search.set(key, trimmed);
    }
  };

  if (params.status !== undefined) {
    search.set("status", params.status);
  }
  setIfPresent("q", params.q);
  setIfPresent("driverId", params.driverId);
  setIfPresent("fromCity", params.fromCity);
  setIfPresent("toCity", params.toCity);

  return search;
}

/**
 * GET /api/v1/admin/trips?status=&q=&driverId=&fromCity=&toCity=&page=&pageSize=
 * Подстрочный поиск `q` по маршруту/адресам/водителю плюс точные фильтры.
 */
export function fetchTrips(params: AdminTripsQuery): Promise<AdminPaginatedTrips> {
  return apiGet(
    "/trips?" + buildTripsSearchParams(params).toString(),
    adminPaginatedTripsSchema,
  );
}

/**
 * GET /api/v1/admin/trips/:id — карточка поездки с ограниченным списком
 * броней и пассажиров. Ответ валидируется fail-closed по контракту.
 */
export function fetchTripDetail(id: string): Promise<AdminTripDetailDto> {
  return apiGet(`/trips/${encodeURIComponent(id)}`, adminTripDetailDtoSchema);
}

/**
 * PATCH /api/v1/admin/trips/:id/cancel — отмена поездки.
 */
export function cancelTrip(id: string): Promise<AdminTripDto> {
  return apiPatch(`/trips/${encodeURIComponent(id)}/cancel`, undefined, adminTripDtoSchema);
}
