import { z } from "zod";
import { MAX_SEATS } from "./trip.schema.js";
import { cityDtoSchema } from "./city.schema.js";

export const RIDE_REQUEST_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  FULFILLED: "fulfilled",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

export const rideRequestStatusSchema = z.enum([
  "active",
  "paused",
  "fulfilled",
  "expired",
  "cancelled",
]);
export type RideRequestStatus = z.infer<typeof rideRequestStatusSchema>;

export const rideRequestSchema = z.object({
  id: z.string().uuid(),
  fromCity: cityDtoSchema,
  toCity: cityDtoSchema,
  earliestAt: z.string().datetime(),
  latestAt: z.string().datetime(),
  seats: z.number().int().min(1).max(MAX_SEATS),
  status: rideRequestStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RideRequest = z.infer<typeof rideRequestSchema>;

/**
 * Спрос на конкретную поездку (`GET /trips/:id/requests`, только водитель):
 * активные заявки других людей, совпадающие по маршруту и пересекающиеся с
 * окном поездки. Зеркало `GET /ride-requests/matching`, ключ — поездка.
 *
 * Форма элемента та же, что у `rideRequestSchema`: автор заявки не отдаётся
 * (privacy — как в ленте спроса), водитель видит окно, места и города.
 *
 * Следствие приватности, о котором важно помнить в UI: «сколько человек
 * ищет попутку» по этому ответу — верхняя оценка `items.length`, а не число
 * разных людей. У одного человека бывает до трёх активных заявок, и две из
 * них на один маршрут посчитаются двумя строками. Точное число людей без
 * раскрытия авторов недостижимо — как и в агрегате `/ride-requests/feed`,
 * где оно считается на сервере из скрытого `userId`.
 */
export const tripRideRequestsResponseSchema = z.object({
  items: z.array(rideRequestSchema),
});
export type TripRideRequestsResponse = z.infer<
  typeof tripRideRequestsResponseSchema
>;

/**
 * Строка ленты спроса (`GET /ride-requests/feed`): агрегат по маршруту, а не
 * отдельная заявка.
 *
 * `people` и `seats` — разные числа, и это не опечатка: человек может просить
 * несколько мест (компания), поэтому «ищут N человек» не значит «нужно N мест».
 * `nextAt` — ближайшее начало окна среди активных заявок маршрута.
 */
export const rideRequestFeedItemSchema = z.object({
  fromCity: cityDtoSchema,
  toCity: cityDtoSchema,
  /** Сколько разных людей оставило заявку на этот маршрут. */
  people: z.number().int().min(1),
  /** Сколько мест суммарно просят по маршруту. */
  seats: z.number().int().min(1).max(MAX_SEATS * 1000),
  nextAt: z.string().datetime(),
});
export type RideRequestFeedItem = z.infer<typeof rideRequestFeedItemSchema>;
