import { z } from "zod";
import {
  rideRequestFeedItemSchema,
  rideRequestSchema,
  type CreateRideRequestDto,
  type RideRequest,
  type RideRequestFeedItem,
  type RideRequestStatus,
  type UpdateRideRequestDto,
} from "@edem/contracts";
import { apiClient } from "./client";

// Лента спроса для главной: бэк отдаёт `{ items }` без пагинации (витрина на
// экран, не список с прокруткой). Элемент — АГРЕГАТ по маршруту, а не заявка:
// людей, мест и ближайшее окно. Автора в ответе нет — лента анонимная.
const rideRequestFeedSchema = z.object({
  items: z.array(rideRequestFeedItemSchema),
});

const rideRequestListSchema = z.object({
  items: z.array(rideRequestSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasMore: z.boolean(),
  }),
});

export type MutableRideRequestStatus = Exclude<RideRequestStatus, "expired">;

export const rideRequestsApi = {
  list: (signal?: AbortSignal): Promise<RideRequest[]> =>
    apiClient.request(
      "/ride-requests",
      { signal },
      rideRequestListSchema.transform(({ items }) => items),
    ),

  /** Агрегаты по маршрутам: по спросу, затем по ближайшему окну. */
  feed: (signal?: AbortSignal): Promise<RideRequestFeedItem[]> =>
    apiClient.request(
      "/ride-requests/feed",
      { signal },
      rideRequestFeedSchema.transform(({ items }) => items),
    ),

  create: (data: CreateRideRequestDto): Promise<RideRequest> =>
    apiClient.request(
      "/ride-requests",
      { method: "POST", body: JSON.stringify(data) },
      rideRequestSchema,
    ),

  update: (id: string, data: UpdateRideRequestDto): Promise<RideRequest> =>
    apiClient.request(
      `/ride-requests/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(data) },
      rideRequestSchema,
    ),

  setStatus: (
    id: string,
    status: MutableRideRequestStatus,
  ): Promise<RideRequest> =>
    apiClient.request(
      `/ride-requests/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
      rideRequestSchema,
    ),

  cancel: (id: string): Promise<RideRequest> =>
    apiClient.request(
      `/ride-requests/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      rideRequestSchema,
    ),
};
