import { describe, expect, it } from "vitest";
import {
  buildSearchFilters,
  dateSegmentToRange,
  EMPTY_SEARCH_FORM,
  formatMaxPriceLabel,
  hasAnySearchFilter,
  parseDateSegmentParam,
  PRICE_SLIDER_MAX,
} from "@/helpers/searchFilters";

// Фиксированное «сегодня» — среда 2026-09-09 (локальная дата),
// чтобы сегменты выходных считались детерминированно.
const NOW = new Date(2026, 8, 9, 12, 0, 0);

describe("dateSegmentToRange", () => {
  it("returns an empty range for all dates", () => {
    expect(dateSegmentToRange("all", NOW)).toEqual({});
  });

  it("maps today to a single local date", () => {
    expect(dateSegmentToRange("today", NOW)).toEqual({
      dateFrom: "2026-09-09",
      dateTo: "2026-09-09",
    });
  });

  it("maps tomorrow to a single local date", () => {
    expect(dateSegmentToRange("tomorrow", NOW)).toEqual({
      dateFrom: "2026-09-10",
      dateTo: "2026-09-10",
    });
  });

  it("maps weekend to the upcoming Saturday–Sunday", () => {
    // 2026-09-09 — среда: ближайшая суббота 12-го, воскресенье 13-го.
    expect(dateSegmentToRange("weekend", NOW)).toEqual({
      dateFrom: "2026-09-12",
      dateTo: "2026-09-13",
    });
  });

  it("keeps the current weekend when today is Saturday", () => {
    const saturday = new Date(2026, 8, 12);
    expect(dateSegmentToRange("weekend", saturday)).toEqual({
      dateFrom: "2026-09-12",
      dateTo: "2026-09-13",
    });
  });

  it("keeps Sunday as the last day of the current weekend", () => {
    const sunday = new Date(2026, 8, 13);
    expect(dateSegmentToRange("weekend", sunday)).toEqual({
      dateFrom: "2026-09-13",
      dateTo: "2026-09-13",
    });
  });
});

describe("parseDateSegmentParam", () => {
  it("accepts known segments", () => {
    expect(parseDateSegmentParam("today")).toBe("today");
    expect(parseDateSegmentParam("tomorrow")).toBe("tomorrow");
    expect(parseDateSegmentParam("weekend")).toBe("weekend");
    expect(parseDateSegmentParam("all")).toBe("all");
  });

  it("falls back to all for garbage and missing values", () => {
    expect(parseDateSegmentParam("yesterday")).toBe("all");
    expect(parseDateSegmentParam("")).toBe("all");
    expect(parseDateSegmentParam(null)).toBe("all");
  });
});

// Id справочника: форма передаёт его выбранным значением, а не именем.
const CITY_VOLOGDA = "11111111-1111-4111-8111-111111111111";
const CITY_CHEREPOVETSK = "22222222-2222-4222-8222-222222222222";

describe("buildSearchFilters", () => {
  it("returns undefined for a pristine form (backend default feed)", () => {
    expect(buildSearchFilters(EMPTY_SEARCH_FORM)).toBeUndefined();
  });

  it("combines cities, date segment, price and tags", () => {
    const filters = buildSearchFilters({
      fromCityId: CITY_VOLOGDA,
      toCityId: CITY_CHEREPOVETSK,
      dateSegment: "today",
      maxPrice: 1500,
      tags: ["Не курить"],
    });
    // Именно id, а не имена: имя неоднозначно («Москва» входит в «Москва-…»),
    // и backend отдаёт подстрочную выдачу с такими совпадениями.
    expect(filters).toMatchObject({
      fromCityId: CITY_VOLOGDA,
      toCityId: CITY_CHEREPOVETSK,
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      maxPrice: 1500,
      tags: ["Не курить"],
    });
    expect(filters).not.toHaveProperty("fromCity");
    expect(filters).not.toHaveProperty("toCity");
    expect(filters?.dateFrom).toBe(filters?.dateTo);
  });

  it("omits the price filter when the slider is at max (any price)", () => {
    const filters = buildSearchFilters({
      ...EMPTY_SEARCH_FORM,
      maxPrice: PRICE_SLIDER_MAX,
    });
    expect(filters).toBeUndefined();
  });

  it("передаёт id города как есть, без обрезки и подстановки имени", () => {
    // Источник — справочник: обрезать нечего, а подставлять имя рядом
    // с id нельзя (рассинхрон).
    const filters = buildSearchFilters({
      ...EMPTY_SEARCH_FORM,
      fromCityId: CITY_VOLOGDA,
    });
    expect(filters).toMatchObject({ fromCityId: CITY_VOLOGDA });
    expect(filters).not.toHaveProperty("fromCity");
  });
});

describe("formatMaxPriceLabel", () => {
  it("returns any-price text without a limit", () => {
    expect(formatMaxPriceLabel(null)).toBe("Любая цена");
  });

  it("formats the cap with roubles", () => {
    expect(formatMaxPriceLabel(1500)).toMatch(/до.*1\s?500.*₽/);
  });
});

describe("hasAnySearchFilter", () => {
  it("пустой набор сбрасывать нечего", () => {
    expect(hasAnySearchFilter(EMPTY_SEARCH_FORM)).toBe(false);
  });

  it("видит любой применённый фильтр", () => {
    expect(hasAnySearchFilter({ ...EMPTY_SEARCH_FORM, maxPrice: 1000 })).toBe(true);
    expect(hasAnySearchFilter({ ...EMPTY_SEARCH_FORM, tags: ["Есть багаж"] })).toBe(true);
    expect(hasAnySearchFilter({ ...EMPTY_SEARCH_FORM, dateSegment: "today" })).toBe(true);
    expect(hasAnySearchFilter({ ...EMPTY_SEARCH_FORM, fromCityId: CITY_VOLOGDA })).toBe(true);
    expect(hasAnySearchFilter({ ...EMPTY_SEARCH_FORM, toCityId: CITY_VOLOGDA })).toBe(true);
  });

  it("сброс доступен и по городам", () => {
    // Пресет из URL (deep link «Москва → Тула») при submitted-поезде давал
    // пустое состояние с погасшей кнопкой — выхода из тупика не было.
    expect(
      hasAnySearchFilter({
        ...EMPTY_SEARCH_FORM,
        fromCityId: CITY_VOLOGDA,
        toCityId: CITY_VOLOGDA,
      }),
    ).toBe(true);
  });
});
