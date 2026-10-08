// Западный TZ: локальный календарный день отличается от московского, и
// дефект «фильтр по зоне устройства» воспроизводится (на московской машине
// разработчика он невидим).
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { dateSegmentToRange } from "@/helpers/searchFilters";

describe("dateSegmentToRange: календарные дни по Москве, не по устройству", () => {
  it("«Сегодня» — московский день, а не локальный", () => {
    // 2026-09-16T02:00Z = 15.09 22:00 в Нью-Йорке, но 16.09 05:00 в Москве.
    const now = new Date("2026-09-16T02:00:00.000Z");
    expect(dateSegmentToRange("today", now)).toEqual({
      dateFrom: "2026-09-16",
      dateTo: "2026-09-16",
    });
    expect(dateSegmentToRange("tomorrow", now)).toEqual({
      dateFrom: "2026-09-17",
      dateTo: "2026-09-17",
    });
  });
});
