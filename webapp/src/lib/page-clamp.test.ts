import { describe, expect, it } from "vitest";

import { clampPageIndex, countPages } from "./page-clamp";

// page-clamp — прижимка индекса страницы. Регрессия F8: индекс жил в
// состоянии компонента, а объём выборки считает сервер; между двумя
// запросами список мог сжаться, и футер показывал «Страница 3 из 2»
// при задизейбленной кнопке «Вперёд» и пустом списке. Модуль чистый,
// поэтому проверяется обычными юнит-тестами (DOM-поведение — за e2e).

describe("countPages", () => {
  it("округляет вверх по целой странице", () => {
    expect(countPages(41, 20)).toBe(3);
    expect(countPages(40, 20)).toBe(2);
    expect(countPages(1, 20)).toBe(1);
  });

  it("пустой список — одна страница, а не ноль", () => {
    // Иначе футер печатал бы «из 0» и «Вперёд» вёл бы в никуда.
    expect(countPages(0, 20)).toBe(1);
  });

  it("некорректный pageSize не даёт бесконечность или NaN", () => {
    expect(countPages(10, 0)).toBe(1);
    expect(countPages(10, -5)).toBe(1);
    expect(countPages(10, Number.NaN)).toBe(1);
    expect(countPages(10, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("отрицательный total не даёт отрицательное число страниц", () => {
    expect(countPages(-1, 20)).toBe(1);
  });
});

describe("clampPageIndex", () => {
  it("в границах — не трогает", () => {
    expect(clampPageIndex(2, 5)).toBe(2);
    expect(clampPageIndex(1, 5)).toBe(1);
  });

  it("сверху — тянет на последнюю (список сжался под текущей страницей)", () => {
    expect(clampPageIndex(3, 2)).toBe(2);
  });

  it("снизу — поднимает на первую", () => {
    expect(clampPageIndex(0, 5)).toBe(1);
    expect(clampPageIndex(-4, 5)).toBe(1);
  });

  it("totalPages < 1 схлопывается в 1, а не в 0", () => {
    expect(clampPageIndex(3, 0)).toBe(1);
    expect(clampPageIndex(3, -2)).toBe(1);
  });

  it("идемпотентна: clamp(clamp(p, m), m) === clamp(p, m)", () => {
    // Эффекты догрузки зовут прижимку повторно; без идемпотентности
    // второй вызов дал бы setState с тем же значением.
    for (const [p, m] of [
      [3, 2],
      [1, 1],
      [9, 4],
      [0, 7],
    ] as const) {
      const once = clampPageIndex(p, m);
      expect(clampPageIndex(once, m)).toBe(once);
    }
  });

  it("дробный индекс усекается ВНИЗ, а не округляется вверх", () => {
    // Именно floor, а не round: округление вверх увело бы админа на
    // несуществующую страницу (2.7 → 3), то есть ПРОПУСТИЛО бы запись.
    expect(clampPageIndex(2.7, 5)).toBe(2);
    expect(clampPageIndex(3.2, 5.9)).toBe(3);
    // Дробный totalPages тоже усекается — «4.9 страницы» не бывает.
    expect(clampPageIndex(9, 4.9)).toBe(4);
  });
});
