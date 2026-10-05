// Файл с принудительным process.env.TZ: обе проверки TZ-зависимые, и на
// машине разработчика (часто Europe/Moscow) дефекты не воспроизводятся —
// Москва фиксирована по смещению, переводов часов нет (инвариант MEMORY §18:
// «TZ-зависимое поведение проверяется файлом с принудительным process.env.TZ»).
//
// 1) dayLabel не должен печатать «undefined» на мусорном месяце.
// 2) «Завтра»/«Выходные» — это КАЛЕНДАРНЫЕ дни, а не «сейчас + 24 часа».
//    В Europe/Berlin с переводом часов локальная полночь + 86 400 000 мс
//    попадает на 23:00 того же дня, и toIsoDate возвращал СЕГОДНЯ.
process.env.TZ = "Europe/Berlin";

import { describe, expect, it } from "vitest";
import { dateSegmentToRange } from "@/helpers/searchFilters";
import { dayLabel } from "@/utils/date";

// Даты вокруг перевода часов в Германии: откат 25.10.2026, перевод 26.10.2026.
const DAY_BEFORE_FALL_BACK = new Date(2026, 9, 24, 12, 0, 0); // СБ, 24.10
const FALL_BACK_DAY = new Date(2026, 9, 25, 12, 0, 0); // ВС, 25.10 — откат
const SPRING_FORWARD_DAY = new Date(2026, 9, 26, 12, 0, 0); // ПН, 26.10 — перевод

describe("dayLabel: месяц вне 1..12", () => {
  it("не печатает «undefined» — отдаёт исходную строку", () => {
    // parseDay такие даты принимает: new Date(2026, 12, 1) → январь 2027,
    // валидный Date. Значит доходили до индексa за пределами массива.
    expect(dayLabel("2026-13-01", DAY_BEFORE_FALL_BACK)).not.toContain(
      "undefined",
    );
    expect(dayLabel("2026-00-10", DAY_BEFORE_FALL_BACK)).not.toContain(
      "undefined",
    );
    expect(dayLabel("2026-13-01", DAY_BEFORE_FALL_BACK)).toBe("2026-13-01");
  });

  it("нормальный месяц по-прежнему печатается словом", () => {
    expect(dayLabel("2026-10-01", DAY_BEFORE_FALL_BACK)).toBe("1 октября");
  });
});

describe("dateSegmentToRange: календарные дни, а не +24 часа", () => {
  it("«Завтра» в день отката часов — следующий день, не сегодня", () => {
    const range = dateSegmentToRange("tomorrow", FALL_BACK_DAY);
    expect(range.dateFrom).toBe("2026-10-26");
    expect(range.dateTo).toBe("2026-10-26");
    // Регрессия давала dateFrom === dateTo === "2026-10-25" (тот же день).
    expect(range.dateFrom).not.toBe("2026-10-25");
  });

  it("«Завтра» в день перевода часов — тоже следующий день", () => {
    const range = dateSegmentToRange("tomorrow", SPRING_FORWARD_DAY);
    expect(range.dateFrom).toBe("2026-10-27");
  });

  it("«Завтра» в обычный день без перевода не сломан", () => {
    expect(dateSegmentToRange("tomorrow", DAY_BEFORE_FALL_BACK)).toEqual({
      dateFrom: "2026-10-25",
      dateTo: "2026-10-25",
    });
  });

  it("«Выходные» в субботу откатной недели — 24–25.10, не схлопывается", () => {
    const range = dateSegmentToRange("weekend", DAY_BEFORE_FALL_BACK);
    expect(range.dateFrom).toBe("2026-10-24");
    expect(range.dateTo).toBe("2026-10-25");
  });

  it("«Выходные» в воскресенье — только этот день (выходные уже идут)", () => {
    // Ветка «уже выходные»: воскресенье — это и dateFrom, и dateTo.
    const range = dateSegmentToRange("weekend", FALL_BACK_DAY);
    expect(range.dateFrom).toBe("2026-10-25");
    expect(range.dateTo).toBe("2026-10-25");
  });

  it("«Выходные» в будний день недели перевода — 31.10–01.11", () => {
    const range = dateSegmentToRange("weekend", SPRING_FORWARD_DAY);
    expect(range.dateFrom).toBe("2026-10-31");
    expect(range.dateTo).toBe("2026-11-01");
  });

  it("«Сегодня» всегда ровно один день", () => {
    for (const day of [
      DAY_BEFORE_FALL_BACK,
      FALL_BACK_DAY,
      SPRING_FORWARD_DAY,
    ]) {
      const range = dateSegmentToRange("today", day);
      expect(range.dateFrom).toBe(range.dateTo);
    }
  });
});
