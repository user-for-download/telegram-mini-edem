import { z } from "zod";
import { userSchema } from "./user.schema.js";

/**
 * Единый источник правды для лимита мест в легковом автомобиле.
 * Используется во входных DTO (создание/редактирование поездки, бронирование)
 * и в UI-формах.
 */
// Максимум 3 пассажирских места: на заднем сидении — не более 2 пассажиров
// (комфортная посадка). 1 место — спереди.
export const MAX_SEATS = 3;

export const tripTagSchema = z.enum([
  "Можно с животными",
  "Можно курить",
  "Есть багаж",
  "Только девушки",
  "Тихая поездка",
  "С остановками",
  "Не курить",
  "Можно с детьми",
  "Разговорчивый",
]);

export type TripTag = z.infer<typeof tripTagSchema>;

export const tripStatusSchema = z.enum(["active", "cancelled", "completed"]);

export type TripStatus = z.infer<typeof tripStatusSchema>;

const localBookingStatusSchema = z.enum(["pending", "confirmed", "declined", "cancelled"]);

export const myBookingSchema = z.object({
  id: z.string(),
  seat: z.number().int().min(1),
  status: localBookingStatusSchema,
  createdAt: z.string().datetime().optional(),
});

export type MyBooking = z.infer<typeof myBookingSchema>;

/**
 * Краткая карточка участника поездки для «аватарстака» водителя.
 * Полный `userSchema` тут избыточен (рейтинг/отзывы/машина не нужны),
 * а платформенные поля наружу не отдаются.
 */
export const tripPassengerSchema = userSchema.pick({
  id: true,
  name: true,
  avatar: true,
});

export type TripPassenger = z.infer<typeof tripPassengerSchema>;

export const tripSchema = z.object({
  id: z.string(),
  fromCity: z.string().min(1),
  // Адреса опциональны: публичные ответы маскируют точное место встречи,
  // участники (водитель, пассажиры с активной бронью) получают полные адреса.
  fromAddress: z.string().optional(),
  toCity: z.string().min(1),
  toAddress: z.string().optional(),
  // FK на справочник City. Nullable для обратной совместимости со
  // старыми поездками (pre-directory). Используется мини-апом, чтобы
  // предзаполнить CityAutocomplete при редактировании.
  fromCityId: z.string().nullable().optional(),
  toCityId: z.string().nullable().optional(),
  date: z.string(),
  time: z.string(),
  departureAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive(),
  distanceKm: z.number().positive(),
  price: z.number().int().positive(),
  seatsTotal: z.number().int().min(1).max(MAX_SEATS),
  seatsAvailable: z.number().int().min(0),
  driver: userSchema,
  tags: z.array(tripTagSchema),
  comment: z.string().max(500).optional(),
  status: tripStatusSchema.optional(),

  bookedSeats: z.array(z.number().int().min(1)).optional(),
  // Подтверждённые пассажиры (id, name, avatar) — только для своих поездок
  // водителя (/trips/my), в публичных ответах отсутствует.
  passengers: z.array(tripPassengerSchema).optional(),
  pendingRequestsCount: z.number().int().min(0).optional(),
  confirmedBookingsCount: z.number().int().min(0).optional(),
  myBooking: myBookingSchema.nullable().optional(),
});

export type Trip = z.infer<typeof tripSchema>;
