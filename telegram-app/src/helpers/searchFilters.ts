// telegram-app/src/helpers/searchFilters.ts
// Поисковые фильтры для ленты поездок: города + сегмент дат (Сегодня/
// Завтра/Выходные/Все) + максимальная цена + теги. Сборка TripFiltersDto.
// Вынесено в helper ради unit-тестов без DOM.
import type { TripTag } from "@edem/contracts";
import type { SearchTripsFilters } from "@/api/trips.api";
import { toIsoDate } from "@/utils/date";

export type DateSegment = "all" | "today" | "tomorrow" | "weekend";

export const DATE_SEGMENTS: ReadonlyArray<{ value: DateSegment; label: string }> = [
  { value: "all", label: "Все даты" },
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
];

/**
 * Календарное приращение дней: конструктор с числом дня, а НЕ сложение
 * 86 400 000 мс.
 *
 * Почему не сложение (аудит 2026-10-05): «завтра» — это следующий
 * КАЛЕНДАРНЫЙ день, а `local midnight + 24h` в зоне с переходом на летнее
 * время даёт 23:00 того же дня. В дни отката/перевода (Europe/Berlin,
 * 25–26.10) `toIsoDate` возвращал СЕГОДНЯШНЮЮ дату, и сегмент «Завтра»
 * показывал сегодняшние поездки. Москва фиксирована по смещению, ошибка там
 * не проявляется — и тесты, гонявшиеся на московском времени, её не видели.
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
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
 * Сегмент дат → диапазон dateFrom/dateTo (локальные даты, ISO):
 * - today/tomorrow — конкретный день;
 * - weekend — ближайшие суббота–воскресенье; если выходные уже идут
 *   (суббота/воскресенье) — от сегодня до воскресенья.
 */
export function dateSegmentToRange(
  segment: DateSegment,
  now: Date = new Date(),
): { dateFrom?: string; dateTo?: string } {
  if (segment === "all") return {};
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (segment === "today") {
    const iso = toIsoDate(today);
    return { dateFrom: iso, dateTo: iso };
  }
  if (segment === "tomorrow") {
    const iso = toIsoDate(addDays(today, 1));
    return { dateFrom: iso, dateTo: iso };
  }
  const dayOfWeek = today.getDay(); // 0 = воскресенье, 6 = суббота
  if (dayOfWeek === 0) {
    const iso = toIsoDate(today);
    return { dateFrom: iso, dateTo: iso };
  }
  const saturday = addDays(today, 6 - dayOfWeek);
  const sunday = addDays(saturday, 1);
  return { dateFrom: toIsoDate(saturday), dateTo: toIsoDate(sunday) };
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
  /** id городов справочника, не имена (решение владельца 2026-10-03). */
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
  // По id, а не по имени: «Москва» входит в «Москва-…», и такой город есть в
  // справочнике от старых прогонов e2e — выбор по имени не различался.
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
 * Вызывается по ПРИМЕНЁННОМУ набору (submitted), а не по форме: запрос
 * едет от submitted, и кнопка сброса в пустом состоянии обязана оставаться
 * рабочей, пока активный запрос отфильтрован. Считая от формы, можно было
 * получить тупик — применить фильтр, дающий 0 результатов, вернуть контролы
 * в нейтраль (без «Найти»), и единственный выход из пустого состояния
 * пропадал (аудит 2026-10-05).
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
