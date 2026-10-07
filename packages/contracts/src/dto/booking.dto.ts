import { z } from "zod";
import { driverBookingActionSchema } from "../schemas/booking.schema.js";
import { MAX_SEATS } from "../schemas/trip.schema.js";

export const createBookingDtoSchema = z.object({
  tripId: z.string(),
  seat: z.number().int().min(1).max(MAX_SEATS),
  comment: z.string().max(300).optional(),
  /**
   * Заявка пассажира, из которой выросла бронь (поток «заявка → поездка»).
   *
   * Опционален и НЕ доверен: сервер проверяет, что заявка принадлежит
   * авторизованному пассажиру, активна и подходит под поездку (маршрут +
   * пересечение окон) общим предикатом `matchingRideRequestWhere`. Не прошла
   * проверку — бронь не создаётся (404), а не «создаётся без привязки».
   *
   * Без него сервер сам находит совпадающие активные заявки пассажира и
   * закрывает их: клиенту нельзя доверять, что он помнит, какую заявку
   * выполняет. Не uuid() — по той же причине, что и `tripId`: существование
   * и принадлежность проверяет БД.
   */
  requestId: z.string().trim().min(1).optional(),
});
export type CreateBookingDto = z.infer<typeof createBookingDtoSchema>;

export const updateBookingStatusDtoSchema = z.object({
  status: driverBookingActionSchema,
});
export type UpdateBookingStatusDto = z.infer<typeof updateBookingStatusDtoSchema>;
