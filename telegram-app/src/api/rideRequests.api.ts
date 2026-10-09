import { z } from "zod";
import {
  rideRequestFeedItemSchema,
  rideRequestSchema,
  tripRideRequestsResponseSchema,
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

export type RideRequestsPage = z.infer<typeof rideRequestListSchema>;

/**
 * Ответ приглашения пассажира: 201 (создано) и 200 (повтор по той же паре
 * заявка+поездка) различаются только флагом `duplicate`, поэтому схема одна.
 *
 * `notificationId: null` — приглашение записано, но уведомление получателю НЕ
 * доставлено (выключенный тумблер или сбой). Вызывающий обязан отличать этот
 * случай от доставленного и не обещать водителю «приглашение ушло».
 *
 * Схема локальная, как `rideRequestFeedSchema` выше: контракт приглашения
 * закрыт в контрактах только типом уведомления, а форма ответа живёт рядом с
 * единственным её вызовом.
 */
const rideRequestInviteSchema = z.object({
  invited: z.boolean(),
  duplicate: z.boolean(),
  notificationId: z.string().nullable(),
});

export type RideRequestInvite = z.infer<typeof rideRequestInviteSchema>;

export type MutableRideRequestStatus = Exclude<RideRequestStatus, "expired">;

export const rideRequestsApi = {
  /**
   * Свои заявки с пагинацией (GET /ride-requests?page&limit). Раньше
   * возвращались только items, а pagination выбрасывалась — список молча
   * упирался в дефолтный limit 20 и старше не показывался вовсе.
   */
  list: (
    page = 1,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<RideRequestsPage> =>
    apiClient.request(
      `/ride-requests?page=${page}&limit=${limit}`,
      { signal },
      rideRequestListSchema,
    ),

  /** Агрегаты по маршрутам: по спросу, затем по ближайшему окну. */
  feed: (signal?: AbortSignal): Promise<RideRequestFeedItem[]> =>
    apiClient.request(
      "/ride-requests/feed",
      { signal },
      rideRequestFeedSchema.transform(({ items }) => items),
    ),

  /**
   * Спрос на конкретную поездку (`GET /trips/:id/requests`) — зеркало
   * `GET /ride-requests/matching`, только ключом поездка. Живёт здесь, а не в
   * `tripsApi`, потому что отдаёт ЗАЯВКИ: тем же правилом, по которому
   * `bookingsApi.getTripBookings` держит поездко-скоупный `/bookings/trip/:id`.
   *
   * Ответ 403 не-водителю и 404 несуществующей поездки — это «спроса нет»,
   * а не поломка: разбирает вызывающий (`useTripDemandQuery` + карточка).
   */
  forTrip: (tripId: string, signal?: AbortSignal): Promise<RideRequest[]> =>
    apiClient.request(
      `/trips/${encodeURIComponent(tripId)}/requests`,
      { signal },
      tripRideRequestsResponseSchema.transform(({ items }) => items),
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

  /**
   * Приглашение пассажира в поездку водителя
   * (`POST /ride-requests/:id/invite`). В теле — ТОЛЬКО поездка: заявка
   * приезжает маршрутом, а лишние поля сервер отверг бы (.strict()).
   *
   * Бронь не создаётся: приглашение — это уведомление `driver_invite`, а место
   * пассажир занимает сам (`POST /bookings`). Отсюда и запрет на «успешную
   * бронь» в UI водителя — показывать ему её нечего.
   */
  invite: (requestId: string, tripId: string): Promise<RideRequestInvite> =>
    apiClient.request(
      `/ride-requests/${encodeURIComponent(requestId)}/invite`,
      { method: "POST", body: JSON.stringify({ tripId }) },
      rideRequestInviteSchema,
    ),
};
