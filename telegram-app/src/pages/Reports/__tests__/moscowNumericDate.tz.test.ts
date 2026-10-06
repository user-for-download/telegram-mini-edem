// Даты обращений/жалоб — по Europe/Moscow.
//
// TZ принудительный: без него тест проходит и на машине в UTC, и в
// America/Los_Angeles — то есть не проверяет ничего.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it } from "vitest";
import { moscowNumericDate } from "@/utils/date";

describe("moscowNumericDate: дата обращения по Москве, не по зоне устройства", () => {
  it("вечер UTC показывается СЛЕДУЮЩИМ числом по Москве", () => {
    // 01.10 22:30 UTC = 02.10 01:30 МСК. В Лос-Анджелесе это 01.10 15:30 —
    // то есть ровно тот случай, который в UI врал.
    expect(moscowNumericDate("2026-10-01T22:30:00.000Z")).toBe("02.10.2026");
  });

  it("утро UTC того же дня — по Москве тоже этот день", () => {
    // 01.10 07:00 UTC = 01.10 10:00 МСК.
    expect(moscowNumericDate("2026-10-01T07:00:00.000Z")).toBe("01.10.2026");
  });

  it("полночь МСК — начало этого же дня по Москве", () => {
    // 01.10 21:00 UTC = 02.10 00:00 МСК ровно.
    expect(moscowNumericDate("2026-10-01T21:00:00.000Z")).toBe("02.10.2026");
  });

  it("невалидный ввод не даёт «Invalid Date»", () => {
    expect(moscowNumericDate("не дата")).toBe("не дата");
    expect(moscowNumericDate(undefined)).toBe("—");
  });
});
