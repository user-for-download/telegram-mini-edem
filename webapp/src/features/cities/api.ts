import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import {
  adminCityDtoSchema,
  paginatedCitiesResponseSchema,
  recomputeCityTripsCountResponseSchema,
  type CityNameBody,
} from "@edem/contracts";
import type {
  AdminCityDto,
  PaginatedCitiesResponse,
  RecomputeCityTripsCountResponse,
} from "@edem/contracts";
import { z } from "zod";

const deleteCityResponseSchema = z.object({ ok: z.literal(true), id: z.string() }).strict();

export interface FetchCitiesParams {
  page: number;
  pageSize: number;
  q?: string;
}

/**
 * GET /api/v1/admin/cities?q=&page=&pageSize= — список точек справочника.
 */
export function fetchCities(
  params: FetchCitiesParams,
): Promise<PaginatedCitiesResponse> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.q) search.set("q", params.q);
  return apiGet(`/cities?${search.toString()}`, paginatedCitiesResponseSchema);
}

/**
 * POST /api/v1/admin/cities — создать новую точку.
 */
export function createCity(name: string): Promise<AdminCityDto> {
  return apiPost("/cities", { name } satisfies CityNameBody, adminCityDtoSchema);
}

/**
 * PATCH /api/v1/admin/cities/:id — переименовать.
 */
export function renameCity(id: string, name: string): Promise<AdminCityDto> {
  return apiPatch(
    `/cities/${encodeURIComponent(id)}`,
    { name } satisfies CityNameBody,
    adminCityDtoSchema,
  );
}

/**
 * DELETE /api/v1/admin/cities/:id — удалить. 409, если есть поездки.
 */
export function deleteCity(id: string): Promise<{ ok: true; id: string }> {
  return apiDelete(`/cities/${encodeURIComponent(id)}`, deleteCityResponseSchema);
}

/** POST /api/v1/admin/cities/recompute-trips-count — идемпотентный пересчёт. */
export function recomputeCityTripsCount(): Promise<RecomputeCityTripsCountResponse> {
  return apiPost(
    "/cities/recompute-trips-count",
    undefined,
    recomputeCityTripsCountResponseSchema,
  );
}
