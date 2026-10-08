import type { Trip } from "@edem/contracts";
import { moscowDayLabel, moscowDayKey } from "@/utils/date";

/**
 * Группировка ленты поиска по календарным дням для пилюль-заголовков.
 * Чистая функция без DOM.
 */
export interface TripDayGroup {
  /**
   * Ключ дня: ISO-дата по Москве из `departureAt`. Без него — `trip.date`
   * как есть (см. `dayKeyOf`).
   */
  key: string;
  /** Подпись пилюли: «Сегодня» / «Завтра» / «12 сентября». */
  label: string;
  trips: Trip[];
}

/**
 * Ключ дня поездки.
 *
 * Ключ берём из `departureAt`, а НЕ из `trip.date`: бэк отдаёт `trip.date`
 * уже отформатированной подписью («сб, 15 марта» — `formatDateRu`, ru-RU +
 * Europe/Moscow, `backend/src/serializers/index.ts:190`), а не ISO-датой.
 * По такой строке `dayLabel()` не срабатывает и всегда отдаёт «Сегодня»/«Завтра»
 * в виде weekday-текста бэка, поэтому группировать по ней нельзя.
 *
 * `moscowDayKey` — тот же часовой по��ис, что и границы фильтра на бэке
 * (`moscowDateBoundary`), так что пилюля совпадает с тем, чем бэк резал выдачу,
 * независимо от TZ устройства.
 *
 * `departureAt` в контракте опционален, а мусорный вход не должен терять
 * карточку: тогда день остаётся тем, что прислал бэк (`trip.date`), и такая
 * карточка просто встанет в отдельную группу с подписью бэка.
 */
function dayKeyOf(trip: Trip): string {
  if (trip.departureAt) {
    const parsed = new Date(trip.departureAt);
    if (!Number.isNaN(parsed.getTime())) return moscowDayKey(parsed);
  }
  return trip.date;
}

/**
 * Группы дней для ленты поиска.
 *
 * Порядок выдачи задаёт бэк: `orderBy: [{ departureAt: "asc" }, { id: "asc" }]`
 * (`backend/src/trips/index.ts:322`), поэтому поездки одного дня идут
 * подряд и группы просто накапливаются в текущую.
 *
 * Именно накопление, а НЕ `Map` по ключу: `Map` схлопнул бы одинаковые дни
 * через другие дни и ПЕРЕСТАВИЛ карточки (15:[т1,т3], 16:[т2]) — выдача
 * перестала бы быть отсортированной по времени. Неотсортированный вход даёт
 * повторные группы с одинаковым ключом, но карточки остаются в своём порядке.
 */
export function groupTripsByDay(trips: readonly Trip[]): TripDayGroup[] {
  const groups: TripDayGroup[] = [];
  for (const trip of trips) {
    const key = dayKeyOf(trip);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.trips.push(trip);
    } else {
      groups.push({ key, label: moscowDayLabel(key), trips: [trip] });
    }
  }
  return groups;
}
