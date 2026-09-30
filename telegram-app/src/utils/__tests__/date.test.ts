import { describe, expect, it } from "vitest";
import { dayLabel, dayTimeLabel, formatArrivalTime, formatDuration, formatMoscowDateTime, toIsoDate, toLocalDateTimeInputValue } from "@/utils/date";

const NOW = new Date(2026, 8, 10, 15, 0, 0); // четверг 2026-09-10

describe("toIsoDate", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("dayLabel", () => {
  it("labels today, tomorrow and yesterday", () => {
    expect(dayLabel("2026-09-10", NOW)).toBe("Сегодня");
    expect(dayLabel("2026-09-11", NOW)).toBe("Завтра");
    expect(dayLabel("2026-09-09", NOW)).toBe("Вчера");
  });

  it("labels far dates as day + genitive month", () => {
    expect(dayLabel("2026-09-14", NOW)).toBe("14 сентября");
    expect(dayLabel("2026-12-02", NOW)).toBe("2 декабря");
  });

  it("passes through garbage input", () => {
    expect(dayLabel("не дата", NOW)).toBe("не дата");
  });

  it("treats date-only strings as local calendar days (no UTC shift)", () => {
    const localNoon = new Date(2026, 8, 10, 12, 0, 0);
    expect(dayLabel(toIsoDate(localNoon), localNoon)).toBe("Сегодня");
    expect(dayLabel("2026-09-11", localNoon)).toBe("Завтра");
  });
});

describe("dayTimeLabel", () => {
  it("combines day label and time", () => {
    expect(dayTimeLabel("2026-09-10", "08:30", NOW)).toBe("Сегодня, 08:30");
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1 ч 30 мин");
  });

  it("formats whole hours without minutes", () => {
    expect(formatDuration(120)).toBe("2 ч");
  });

  it("formats sub-hour durations", () => {
    expect(formatDuration(45)).toBe("45 мин");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("formatArrivalTime", () => {
  it("adds duration to departure time", () => {
    expect(formatArrivalTime("10:00", 120)).toBe("12:00");
    expect(formatArrivalTime("09:30", 45)).toBe("10:15");
  });

  it("wraps past midnight", () => {
    expect(formatArrivalTime("23:30", 90)).toBe("01:00");
  });

  it("returns empty string for invalid input", () => {
    expect(formatArrivalTime("", 60)).toBe("");
    expect(formatArrivalTime("10:00", 0)).toBe("");
  });
});

describe("toLocalDateTimeInputValue", () => {
  it("formats local wall time for datetime-local (not UTC)", () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 8, 10, 15, 4, 0))).toBe(
      "2026-09-10T15:04",
    );
  });

  it("round-trips through datetime-local parsing", () => {
    const original = new Date(2026, 8, 10, 15, 4, 0);
    const parsed = new Date(toLocalDateTimeInputValue(original));
    expect(parsed.getTime()).toBe(original.getTime());
  });
});

describe("formatMoscowDateTime", () => {
  it("formats UTC ISO in Moscow wall time", () => {
    // 15:00Z = 18:00 МСК.
    expect(formatMoscowDateTime("2026-09-30T15:00:00.000Z")).toBe(
      "30 сентября, 18:00",
    );
  });

  it("returns a dash for missing or invalid input", () => {
    expect(formatMoscowDateTime(undefined)).toBe("—");
    expect(formatMoscowDateTime("не дата")).toBe("—");
  });
});
