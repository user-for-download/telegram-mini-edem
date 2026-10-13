// Западный TZ: устройство ПОЗАДИ Москвы на 7 часов, поэтому наивный
// `toLocalDateTimeInputValue` через геттеры даты уводил дефолт назад, а
// пара «дефолт → разбор» разъезжалась: поле показывало одно стенное время,
// а fromMoscowDateTimeInput читал его как Москву.
// На московской машине расхождение невидимо — без принудительного TZ тест
// проходит и на старом коде, то есть не проверяет ничего.
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import {
  fromMoscowDateTimeInput,
  toLocalDateTimeInputValue,
} from "@/utils/date";

describe("datetime-local по Москве, а не по зоне устройства", () => {
  it("кладёт в поле московское стенное время, а не локальное", () => {
    // 05:00Z = 08:00 МСК = 01:00 в Нью-Йорке. Старый код через getHours()
    // давал "2026-10-20T01:00" — начало окна уезжало на 7 часов.
    expect(
      toLocalDateTimeInputValue(new Date("2026-10-20T05:00:00.000Z")),
    ).toBe("2026-10-20T08:00");
  });

  it("держит календарный день через границу UTC-суток", () => {
    // 00:30 МСК 20-го = 21:30Z 19-го = 17:30 19-го в Нью-Йорке. Старый код
    // давал "2026-10-19T17:30" — поездка уезжала на день раньше введённого.
    expect(
      toLocalDateTimeInputValue(new Date("2026-10-19T21:30:00.000Z")),
    ).toBe("2026-10-20T00:30");
  });

  it("round-trip дефолт → разбор возвращает тот же момент", () => {
    const original = new Date("2026-10-20T05:00:00.000Z");
    const roundTripped = fromMoscowDateTimeInput(
      toLocalDateTimeInputValue(original),
    );
    // Старый код: поле "01:00" читалось как 01:00 МСК (22:00Z 19-го) —
    // на 7 часов раньше исходного момента.
    expect(roundTripped?.toISOString()).toBe("2026-10-20T05:00:00.000Z");
  });
});
