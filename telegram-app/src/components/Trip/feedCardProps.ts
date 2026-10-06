import type { Trip } from "@edem/contracts";
import type { StatusTone } from "@/components/StatusPill/StatusPill";
import type { TripStandardPerson } from "@/components/Section/TripStandardCard";

/**
 * Feed-наполнение публичной ленты поверх эталона TripStandardCard:
 * пилюля мест вместо статуса брони, водитель вместо персоны роли.
 * Чистые функции без DOM — покрыты unit-тестами без jsdom.
 */

/** Пилюля мест: занятость — единственный «статус» ленты. */
export interface FeedSeats {
  label: string;
  tone: StatusTone;
}

export function feedSeats(trip: Pick<Trip, "seatsAvailable">): FeedSeats {
  if (trip.seatsAvailable === 0) return { label: "Мест нет", tone: "danger" };
  return {
    label: `Осталось мест: ${trip.seatsAvailable}`,
    tone: trip.seatsAvailable <= 1 ? "warning" : "success",
  };
}

/** Персона ленты: водитель (имя/аватар/рейтинг + авто). */
export function feedPerson(trip: Trip): TripStandardPerson {
  const car = trip.driver.car;
  return {
    name: trip.driver.name,
    avatar: trip.driver.avatar,
    rating: trip.driver.rating,
    subtitle: car ? `${car.model} · ${car.color}` : "Водитель",
    showCarIcon: Boolean(car),
  };
}
