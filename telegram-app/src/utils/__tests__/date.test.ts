import { describe, expect, it } from "vitest";
import { dayLabel, formatArrivalTime, formatDuration, formatMoscowDateTime, fromMoscowDateTimeInput, relativeMoscowDay, moscowDayKey, moscowDayLabel, moscowTimeLabel, toIsoDate, toLocalDateTimeInputValue } from "@/utils/date";

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

describe("moscowDayLabel", () => {
  // 2026-09-12T22:00Z = 01:00 МСК 13-го: ключ дня — 13-е, а не 12-е.
  const NOW = new Date("2026-09-12T22:00:00.000Z");

  it("относительные подписи считаются от московского дня", () => {
    expect(moscowDayLabel("2026-09-13", NOW)).toBe("Сегодня");
    expect(moscowDayLabel("2026-09-14", NOW)).toBe("Завтра");
    expect(moscowDayLabel("2026-09-12", NOW)).toBe("Вчера");
    expect(moscowDayLabel("2026-09-20", NOW)).toBe("20 сентября");
  });

  it("не-ключ (подпись бэка) не ломается — уходит в dayLabel", () => {
    expect(moscowDayLabel("сб, 12 сентября", NOW)).toBe("сб, 12 сентября");
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
  it("formats Moscow wall time for datetime-local (not UTC, not device zone)", () => {
    // 12:04Z = 15:04 МСК. Момент абсолютный, поэтому утверждение честно в
    // любом TZ устройства (геттеры даты дали бы зону устройства, а
    // toISOString — UTC).
    expect(toLocalDateTimeInputValue(new Date("2026-09-10T12:04:00.000Z"))).toBe(
      "2026-09-10T15:04",
    );
  });

  it("round-trips with fromMoscowDateTimeInput to the same instant", () => {
    // Дефолт и разбор — пара через одну зону: что положили в поле, то и
    // прочитали, в любом TZ устройства.
    const original = new Date("2026-09-10T12:04:00.000Z");
    const roundTripped = fromMoscowDateTimeInput(
      toLocalDateTimeInputValue(original),
    );
    expect(roundTripped?.getTime()).toBe(original.getTime());
  });

  it("returns an empty string for an invalid date", () => {
    expect(toLocalDateTimeInputValue(new Date("не дата"))).toBe("");
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

describe("fromMoscowDateTimeInput", () => {
  // Регресс: ввод «08:00» раньше читался в зоне устройства, из-за чего
  // поездка публиковалась на час (Dubai) или на семь часов (Нью-Йорк)
  // раньше времени, которое водитель видит в своей же ленте.
  // Инвариант проверяется через московские форматтеры — они не зависят от
  // зоны процесса, поэтому тест честен в любом TZ.
  it("reads the wall clock as Moscow regardless of device timezone", () => {
    const parsed = fromMoscowDateTimeInput("2026-10-20T08:00");
    expect(parsed).not.toBeNull();
    expect(moscowTimeLabel(parsed!)).toBe("08:00");
    expect(moscowDayKey(parsed!)).toBe("2026-10-20");
  });

  it("resolves the same instant for the same wall clock on every device", () => {
    // Москва — UTC+3 без перехода, поэтому 08:00 МСК это всегда 05:00Z.
    // Раньше здесь получалось 08:00Z у клиента в Дубае и 12:00Z в Нью-Йорке.
    expect(fromMoscowDateTimeInput("2026-10-20T08:00")?.toISOString()).toBe(
      "2026-10-20T05:00:00.000Z",
    );
    expect(fromMoscowDateTimeInput("2026-01-15T23:45")?.toISOString()).toBe(
      "2026-01-15T20:45:00.000Z",
    );
  });

  it("handles midnight and end of day", () => {
    expect(fromMoscowDateTimeInput("2026-10-20T00:00")?.toISOString()).toBe(
      "2026-10-19T21:00:00.000Z",
    );
    expect(fromMoscowDateTimeInput("2026-10-20T23:59")?.toISOString()).toBe(
      "2026-10-20T20:59:00.000Z",
    );
  });

  it("keeps the entered calendar day across the UTC boundary", () => {
    // Полночь МСК = 21:00 предыдущего дня UTC. Наивный разбор дал бы
    // 20 октября, и поездка уехала бы на день раньше введенного.
    const parsed = fromMoscowDateTimeInput("2026-10-20T00:30");
    expect(moscowDayKey(parsed!)).toBe("2026-10-20");
  });

  it("returns null for malformed input instead of an invalid date", () => {
    expect(fromMoscowDateTimeInput("")).toBeNull();
    expect(fromMoscowDateTimeInput("не дата")).toBeNull();
    expect(fromMoscowDateTimeInput("2026-10-20")).toBeNull();
    // Месяц 13 Date.UTC тихо перекатывает на январь следующего года.
    expect(fromMoscowDateTimeInput("2026-13-01T08:00")).toBeNull();
    expect(fromMoscowDateTimeInput("2026-10-20T25:00")).toBeNull();
    expect(fromMoscowDateTimeInput("2026-10-20T08:61")).toBeNull();
    expect(fromMoscowDateTimeInput("2026-00-10T08:00")).toBeNull();
  });
});

describe("relativeMoscowDay", () => {
  // Регресс L2: подписи на карточке поездки и в истории звали dayLabel(trip.date),
  // а бэк отдаёт trip.date ГОТОВОЙ ПОДПИСЬЮ ru-RU («ср, 16 сентября»,
  // serializers/index.ts formatDateRu). Regex ждал ISO-день, new Date такую
  // строку не разбирает -> функция отдавала строку как есть, и «Сегодня»/
  // «Завтра» были недостижимы.
  const NOW = new Date("2026-09-16T12:00:00.000Z");

  it("сегодня/завтра/вчера по ISO-моменту отправления", () => {
    expect(relativeMoscowDay("2026-09-16T09:00:00.000Z", NOW)).toBe("Сегодня");
    expect(relativeMoscowDay("2026-09-17T09:00:00.000Z", NOW)).toBe("Завтра");
    expect(relativeMoscowDay("2026-09-15T09:00:00.000Z", NOW)).toBe("Вчера");
  });

  it("чужая подпись бэка не ломает разбор: берём дату из departureAt", () => {
    // Ровно то, что приходило из API: 16 сентября 2026, 12:00 МСК.
    expect(relativeMoscowDay("2026-09-16T09:00:00.000Z", NOW)).not.toContain(
      "сентября",
    );
  });

  it("текущий год без года, чужой год — с годом", () => {
    // Поездка 2030 обязана показывать год, иначе «1 июня» читается как
    // прошедшая дата (регресс поймал tripDetailsPage.test).
    expect(relativeMoscowDay("2030-06-01T06:00:00.000Z", NOW)).toBe(
      "1 июня 2030",
    );
    expect(relativeMoscowDay("2026-12-24T06:00:00.000Z", NOW)).toBe("24 декабря");
  });

  it("нечитаемый ввод — прочерк, а не «Invalid Date»", () => {
    expect(relativeMoscowDay(undefined, NOW)).toBe("—");
    expect(relativeMoscowDay("", NOW)).toBe("—");
    expect(relativeMoscowDay("не дата", NOW)).toBe("—");
  });
});
