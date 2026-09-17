import type { PassengerBooking } from "@edem/contracts";

/**
 * Чистые хелперы разделения броней по статусам для главной страницы.
 * DOM-free (тестируются без jsdom) — по паттерну pages/*Validation.ts.
 */

export interface BookingsByStatus {
  confirmed: PassengerBooking[];
  pending: PassengerBooking[];
}

function departureTime(booking: PassengerBooking): number {
  if (!booking.trip?.departureAt) return Number.NaN;
  const time = Date.parse(booking.trip.departureAt);
  return Number.isFinite(time) ? time : Number.NaN;
}

/**
 * Бронь активной (будущей) поездки: отправление ещё не наступило.
 * Прошедшие confirmed-брони — это уже история, не «Ваша поездка».
 * Бронь без валидной даты отправления активной не считается.
 */
export function isUpcomingBooking(
  booking: PassengerBooking,
  now: Date = new Date(),
): boolean {
  const time = departureTime(booking);
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * Разделение на будущие confirmed («Ваша поездка») и future pending
 * («Ожидают подтверждения»), сортировка внутри групп по времени
 * отправления — ближайшая сверху; брони без даты — в конец.
 */
export function splitBookingsByStatus(
  bookings: PassengerBooking[],
  now: Date = new Date(),
): BookingsByStatus {
  const confirmed: PassengerBooking[] = [];
  const pending: PassengerBooking[] = [];

  for (const booking of bookings) {
    if (!isUpcomingBooking(booking, now)) continue;
    if (booking.status === "confirmed") confirmed.push(booking);
    else if (booking.status === "pending") pending.push(booking);
  }

  const sortTime = (booking: PassengerBooking): number => {
    const time = departureTime(booking);
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
  };
  const byDeparture = (a: PassengerBooking, b: PassengerBooking) =>
    sortTime(a) - sortTime(b);

  confirmed.sort(byDeparture);
  pending.sort(byDeparture);

  return { confirmed, pending };
}

/**
 * Заголовок секции confirmed-броней: единственное число для одной брони.
 */
export function confirmedSectionHeader(count: number): string {
  return count === 1 ? "Ваша поездка" : "Ваши поездки";
}

/**
 * «1 место», «2 места», «5 мест» — для subtitle ячеек и описаний.
 */
export function formatSeats(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} место`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${count} места`;
  return `${count} мест`;
}