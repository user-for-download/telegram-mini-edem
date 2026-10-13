// TZ-конвенция `buildMatchingTripsQuery`: значения полей формы — стенное
// время ПО МОСКВЕ, поэтому и в окно дат уходят московские календарные дни.
// Наивный `new Date("…T18:00")` читал их в зоне устройства, и в America/New_York
// (UTC-4) московское вечернее окно попадало на СЛЕДУЮЩИЙ день: проверка
// спрашивала чужое окно и не находила поездку, которая едет. Знак смещения
// зависит от пояса и времени суток — поэтому проверяются оба края окна.
// Файл с принудительным TZ обязателен: на машине в UTC или в Europe/Moscow
// этот дефект не воспроизводится — тест проходит и не проверяет ничего
// (инвариант, MEMORY.md §18).
import { describe, expect, it } from "vitest";
import { buildMatchingTripsQuery } from "@/components/Trip/matchingTripsSearch";

describe("buildMatchingTripsQuery — московские дни", () => {
  it("вечернее окно по Москве не уезжает на следующий день в UTC-4", () => {
    // 18:00 МСК = 14:00 UTC в Нью-Йорке, но `moscowDayKey` пересчитывает
    // МГНОВЕНИЕ обратно в Москву — то есть 21:00 МСК того же дня. Старый
    // код разбирал «18:00» как 14:00 EST = 21:00 МСК, отсюда лишние сутки
    // в dateTo (2026-10-17 вместо 2026-10-16).
    const query = buildMatchingTripsQuery({
      fromCityId: "c1",
      toCityId: "c2",
      earliest: "2026-10-15T00:30",
      latest: "2026-10-16T18:00",
    });

    expect(query?.dateFrom).toBe("2026-10-15");
    expect(query?.dateTo).toBe("2026-10-16");
  });

  it("раннее окно не уезжает на предыдущий день в UTC-4", () => {
    // 00:00 МСК = предыдущие сутки в Нью-Йорке: `new Date` дал бы 2026-10-14,
    // то есть проверка искала бы окно, которого не существует.
    const query = buildMatchingTripsQuery({
      fromCityId: "c1",
      toCityId: "c2",
      earliest: "2026-10-15T00:00",
      latest: "2026-10-15T23:59",
    });

    expect(query?.dateFrom).toBe("2026-10-15");
    expect(query?.dateTo).toBe("2026-10-15");
  });

  it("бросает маршрут и окно бросает в null при мусоре во входе", () => {
    expect(
      buildMatchingTripsQuery({
        fromCityId: "c1",
        toCityId: "c2",
        earliest: "мусор",
        latest: "2026-10-16T18:00",
      }),
    ).toBeNull();
  });

  it("без городов проверять нечего", () => {
    expect(
      buildMatchingTripsQuery({
        fromCityId: "",
        toCityId: "c2",
        earliest: "2026-10-15T10:00",
        latest: "2026-10-16T18:00",
      }),
    ).toBeNull();
  });
});
