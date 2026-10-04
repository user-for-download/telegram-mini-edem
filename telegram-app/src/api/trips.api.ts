import {
  paginatedTripsResponseSchema,
  tripSchema,
  type CreateTripDto,
  type PaginatedTripsResponse,
  type Trip,
  type TripFiltersDto,
  type UpdateTripDto,
} from "@edem/contracts";
import { apiClient } from "./client";

export type SearchTripsFilters = TripFiltersDto;
export type { UpdateTripDto };

export interface MyTripsOptions {
  page?: number;
  limit?: number;
  status?: "active" | "archive";
}

function toTripsQuery(filters?: SearchTripsFilters): string {
  const query = new URLSearchParams();

  if (filters?.q) query.set("q", filters.q);
  if (filters?.fromCity) query.set("fromCity", filters.fromCity);
  if (filters?.toCity) query.set("toCity", filters.toCity);
  if (filters?.fromCityId) query.set("fromCityId", filters.fromCityId);
  if (filters?.toCityId) query.set("toCityId", filters.toCityId);
  if (filters?.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) query.set("dateTo", filters.dateTo);
  if (filters?.maxPrice !== undefined) query.set("maxPrice", String(filters.maxPrice));
  if (filters?.tags?.length) query.set("tags", filters.tags.join(","));
  if (filters?.page !== undefined) query.set("page", String(filters.page));
  if (filters?.limit !== undefined) query.set("limit", String(filters.limit));

  const value = query.toString();
  return value ? `?${value}` : "";
}

export const tripsApi = {
  getTrips: (
    filters?: SearchTripsFilters,
    signal?: AbortSignal,
  ): Promise<PaginatedTripsResponse> =>
    apiClient.request(
      `/trips${toTripsQuery(filters)}`,
      { signal },
      paginatedTripsResponseSchema,
    ),

  getMyTrips: (
    options?: MyTripsOptions,
    signal?: AbortSignal,
  ): Promise<PaginatedTripsResponse> => {
    const query = new URLSearchParams();
    if (options?.page !== undefined) query.set("page", String(options.page));
    if (options?.limit !== undefined) query.set("limit", String(options.limit));
    if (options?.status) query.set("status", options.status);
    const value = query.toString();

    return apiClient.request(
      `/trips/my${value ? `?${value}` : ""}`,
      { signal },
      paginatedTripsResponseSchema,
    );
  },

  getTripById: (id: string, signal?: AbortSignal): Promise<Trip> =>
    apiClient.request(
      `/trips/${encodeURIComponent(id)}`,
      { signal },
      tripSchema,
    ),

  createTrip: (data: CreateTripDto): Promise<Trip> =>
    apiClient.request(
      "/trips",
      { method: "POST", body: JSON.stringify(data) },
      tripSchema,
    ),

  updateTrip: (id: string, data: UpdateTripDto): Promise<Trip> =>
    apiClient.request(
      `/trips/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(data) },
      tripSchema,
    ),

  cancelTrip: (id: string): Promise<Trip> =>
    apiClient.request(
      `/trips/${encodeURIComponent(id)}/cancel`,
      { method: "PATCH" },
      tripSchema,
    ),

  completeTrip: (id: string): Promise<Trip> =>
    apiClient.request(
      `/trips/${encodeURIComponent(id)}/complete`,
      { method: "PATCH" },
      tripSchema,
    ),
};
