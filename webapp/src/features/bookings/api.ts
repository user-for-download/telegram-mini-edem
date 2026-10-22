import { apiGet, apiPatch } from "@/lib/api-client";
import {
  adminBookingDetailDtoSchema,
  adminBookingDtoSchema,
  adminPaginatedBookingsSchema,
  type AdminBookingDetailDto,
  type AdminBookingDto,
  type AdminBookingStatusBody,
  type AdminBookingsQuery,
  type AdminPaginatedBookings,
} from "@edem/contracts";

export type FetchBookingsParams = AdminBookingsQuery;

/**
 * Query-строка списка броней. Активные фильтры попадают в запрос,
 * пустые/пробельные — опускаются: отсутствие параметра бэкенд трактует
 * как «фильтр не задан» (см. adminBookingsQuerySchema).
 *
 * Вынесено в чистую функцию, чтобы поведение фильтров покрывалось
 * node-тестами без DOM (webapp/vitest.config.ts).
 */
export function buildBookingsSearchParams(
  params: AdminBookingsQuery,
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
  setIfPresent("passengerId", params.passengerId);
  setIfPresent("tripId", params.tripId);

  return search;
}

/**
 * GET /api/v1/admin/bookings?status=&q=&passengerId=&tripId=&page=&pageSize=
 * Подстрочный поиск `q` по пассажиру/маршруту/адресам плюс точные фильтры.
 */
export function fetchBookings(
  params: FetchBookingsParams,
): Promise<AdminPaginatedBookings> {
  return apiGet(
    "/bookings?" + buildBookingsSearchParams(params).toString(),
    adminPaginatedBookingsSchema,
  );
}

/**
 * GET /api/v1/admin/bookings/:id — карточка брони с контекстом поездки
 * (маршрут, отправление, статус, водитель) и пассажира (аватар, рейтинг,
 * телефон). Ответ валидируется fail-closed по контракту.
 */
export function fetchBookingDetail(id: string): Promise<AdminBookingDetailDto> {
  return apiGet(
    `/bookings/${encodeURIComponent(id)}`,
    adminBookingDetailDtoSchema,
  );
}

export function updateBookingStatus(
  id: string,
  body: AdminBookingStatusBody,
): Promise<AdminBookingDto> {
  return apiPatch(
    `/bookings/${encodeURIComponent(id)}/status`,
    body,
    adminBookingDtoSchema,
  );
}
