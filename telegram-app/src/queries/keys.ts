// Ключи кэша react-query в одном месте.
//
// Зачем отдельный модуль: ключи нужны не только своему хуку, а чужим
// мутациям для инвалидации. Раньше TRIP_KEYS жил в useTripsQuery, а
// BOOKING_KEYS — в useBookingsQuery, который уже импортирует TRIP_KEYS.
// Обратный импорт (за BOOKING_KEYS из useTripsQuery) дал бы цикл модулей,
// поэтому три места инвалидации писали ключ литералом — `["bookings"]`,
// `["trips"]`. Смена префикса в одном файле тихо ломала бы инвалидацию в
// другом: ни ошибки компиляции, ни падения теста.
//
// Здесь только константы ключей: модуль не импортирует НИ ОДНОГО хука
// запроса, поэтому цикл невозможен по построению. Тип фильтра поиска
// берётся type-only из api-слоя — тот про запросы не знает.
import type { SearchTripsFilters } from "@/api/trips.api";

export const TRIP_KEYS = {
  all: ["trips"] as const,
  lists: () => [...TRIP_KEYS.all, "list"] as const,
  list: (filters?: SearchTripsFilters) =>
    [...TRIP_KEYS.lists(), filters] as const,
  my: () => [...TRIP_KEYS.all, "my"] as const,
  details: () => [...TRIP_KEYS.all, "detail"] as const,
  detail: (id: string) => [...TRIP_KEYS.details(), id] as const,
};

export const BOOKING_KEYS = {
  all: ["bookings"] as const,
  my: () => [...BOOKING_KEYS.all, "my"] as const,
  history: () => [...BOOKING_KEYS.all, "history"] as const,
  trip: (tripId: string) => [...BOOKING_KEYS.all, "trip", tripId] as const,
  driver: () => [...BOOKING_KEYS.all, "driver"] as const,
};
