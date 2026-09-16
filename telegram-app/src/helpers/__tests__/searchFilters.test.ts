import { describe, expect, it } from "vitest";
import {
  buildSearchFilters,
  dateSegmentToRange,
  EMPTY_SEARCH_FORM,
  formatMaxPriceLabel,
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

describe("buildSearchFilters", () => {
  it("returns undefined for a pristine form (backend default feed)", () => {
    expect(buildSearchFilters(EMPTY_SEARCH_FORM)).toBeUndefined();
  });

  it("combines cities, date segment, price and tags", () => {
    const filters = buildSearchFilters({
      fromCity: "Вологда",
      toCity: "Череповец",
      dateSegment: "today",
      maxPrice: 1500,
      tags: ["Не курить"],
    });
    expect(filters).toMatchObject({
      fromCity: "Вологда",
      toCity: "Череповец",
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      maxPrice: 1500,
      tags: ["Не курить"],
    });
    expect(filters?.dateFrom).toBe(filters?.dateTo);
  });

  it("omits the price filter when the slider is at max (any price)", () => {
    const filters = buildSearchFilters({
      ...EMPTY_SEARCH_FORM,
      maxPrice: PRICE_SLIDER_MAX,
    });
    expect(filters).toBeUndefined();
  });

  it("trims city names", () => {
    const filters = buildSearchFilters({
      ...EMPTY_SEARCH_FORM,
      fromCity: "  Вологда  ",
    });
    expect(filters).toMatchObject({ fromCity: "Вологда" });
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
