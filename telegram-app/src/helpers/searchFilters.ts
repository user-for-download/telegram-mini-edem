// telegram-app/src/helpers/searchFilters.ts
// Поисковые фильтры для ленты поездок: города + сегмент дат (Сегодня/
// Завтра/Выходные/Все) + максимальная цена + теги. Сборка TripFiltersDto.
// Вынесено в helper ради unit-тестов без DOM.
import type { TripTag } from "@edem/contracts";
import type { SearchTripsFilters } from "@/api/trips.api";
import { moscowDayKey } from "@/utils/date";

export type DateSegment = "all" | "today" | "tomorrow" | "weekend";

export const DATE_SEGMENTS: ReadonlyArray<{ value: DateSegment; label: string }> = [
  { value: "all", label: "Все даты" },
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
];

/**
 * Календарное приращение дней к ключу дня "YYYY-MM-DD" через UTC-полночь:
 * сложение 86 400 000 мс в локальной зоне с переводом часов даёт 23:00
 * того же дня. Ключ уже московский, а переводов часов в Москве нет.
 */
function addDaysToKey(key: string, days: number): string {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function parseSegment(value: string | null): DateSegment {
  return value === "today" || value === "tomorrow" || value === "weekend"
    ? value
    : "all";
}

/** URL-параметр ?segment= → DateSegment (мусор → "all"). */
export function parseDateSegmentParam(value: string | null): DateSegment {
  return parseSegment(value);
}

/**
 * Сегмент дат → диапазон dateFrom/dateTo (МОСКОВСКИЕ календарные дни, ISO).
 *
 * Бэкенд разбирает dateFrom/dateTo как границы московских суток
 * (`moscowDateBoundary`), поэтому и клиент обязан считать «сегодня/завтра/
 * выходные» по Москве, а не по зоне устройства: иначе у клиента западнее/
 * восточнее МСК фильтр уезжает на сутки.
 * - today/tomorrow — конкретный день;
 * - weekend — ближайшие суббота–воскресенье; если выходные уже идут
 *   (суббота/воскресенье) — от сегодня до воскресенья.
 */
export function dateSegmentToRange(
  segment: DateSegment,
  now: Date = new Date(),
): { dateFrom?: string; dateTo?: string } {
  if (segment === "all") return {};
  const today = moscowDayKey(now);
  if (segment === "today") {
    return { dateFrom: today, dateTo: today };
  }
  if (segment === "tomorrow") {
    const iso = addDaysToKey(today, 1);
    return { dateFrom: iso, dateTo: iso };
  }
  // 0 = воскресенье, 6 = суббота — день недели московской календарной даты.
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (dayOfWeek === 0) {
    return { dateFrom: today, dateTo: today };
  }
  const saturday = addDaysToKey(today, 6 - dayOfWeek);
  const sunday = addDaysToKey(saturday, 1);
  return { dateFrom: saturday, dateTo: sunday };
}

/**
 * Границы слайдера «Цена не выше» (SearchPage, tgui Slider):
 * сид-цены 300–1100 ₽, межгород с запасом — до 3000, шаг 100.
 * Крайнее правое положение (MAX) означает «любая цена» — фильтр снимается.
 */
export const PRICE_SLIDER_MIN = 100;
export const PRICE_SLIDER_MAX = 3000;
export const PRICE_SLIDER_STEP = 100;

export interface SearchFormState {
  /** id городов справочника, не имена. */
  fromCityId: string;
  toCityId: string;
  dateSegment: DateSegment;
  /** null — без лимита («любая цена», крайнее правое положение слайдера). */
  maxPrice: number | null;
  tags: TripTag[];
}

export const EMPTY_SEARCH_FORM: SearchFormState = {
  fromCityId: "",
  toCityId: "",
  dateSegment: "all",
  maxPrice: null,
  tags: [],
};

export function buildSearchFilters(
  state: SearchFormState,
): SearchTripsFilters | undefined {
  const result: SearchTripsFilters = {};
  // По id, а не по имени: подстрока имени неоднозначна
  // («Москва» входит в «Москва-…»).
  if (state.fromCityId) result.fromCityId = state.fromCityId;
  if (state.toCityId) result.toCityId = state.toCityId;
  const range = dateSegmentToRange(state.dateSegment);
  if (range.dateFrom) result.dateFrom = range.dateFrom;
  if (range.dateTo) result.dateTo = range.dateTo;
  // Слайдер всегда отдаёт число в [MIN, MAX]; MAX означает «любая цена».
  const maxPrice = state.maxPrice;
  if (
    maxPrice !== null &&
    Number.isFinite(maxPrice) &&
    maxPrice > 0 &&
    maxPrice < PRICE_SLIDER_MAX
  ) {
    result.maxPrice = Math.floor(maxPrice);
  }
  if (state.tags.length > 0) result.tags = [...state.tags];
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Есть ли в наборе хоть что-то, что сброс снимет.
 *
 * Считается по ПРИМЕНЁННОМУ набору (submitted), а не по форме: запрос
 * едет от submitted, и кнопка сброса обязана оставаться рабочей, пока
 * активный запрос отфильтрован.
 */
export function hasAnySearchFilter(state: SearchFormState): boolean {
  return (
    state.maxPrice !== null ||
    state.tags.length > 0 ||
    state.dateSegment !== "all" ||
    state.fromCityId !== "" ||
    state.toCityId !== ""
  );
}

/** Подпись слайдера цены: «до 1 500 ₽» или «Любая цена» без лимита. */
export function formatMaxPriceLabel(maxPrice: number | null): string {
  if (maxPrice === null) return "Любая цена";
  return `до ${maxPrice.toLocaleString("ru-RU")} ₽`;
}
