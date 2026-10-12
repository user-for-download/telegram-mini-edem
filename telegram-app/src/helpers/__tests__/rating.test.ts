import { describe, expect, it } from "vitest";
import { formatRating, hasRating } from "@/helpers/rating";

// Регресс M4: контракт отдаёт rating обязательным (min 0, max 5), поэтому
// «рейтинга нет» приходит ЧИСЛОМ. Новый пользователь создаётся с rating: 5
// (auth/index.ts) при reviewsCount 0 — и светился как «идеальная оценка»,
// будто его хвалили. 0.0 пишет recomputeUserRating, когда опубликованных
// отзывов не осталось. Оба значения при нуле отзывов — это отсутствие.
describe("hasRating", () => {
  it("оценка есть, когда есть отзывы", () => {
    expect(hasRating(4.9, 10)).toBe(true);
    expect(hasRating(3, 1)).toBe(true);
  });

  it("rating 5.0 при нуле отзывов — оценки НЕТ", () => {
    expect(hasRating(5, 0)).toBe(false);
  });

  it("rating 0.0 при нуле отзывов — оценки НЕТ", () => {
    expect(hasRating(0, 0)).toBe(false);
  });

  it("0.0 при наличии отзывов — оценка есть", () => {
    // Отзывы есть, среднее 0 правдоподобно (все — единицы); гасить нельзя.
    expect(hasRating(0, 3)).toBe(true);
  });

  it("null/NaN — оценки нет", () => {
    expect(hasRating(null, 10)).toBe(false);
    expect(hasRating(Number.NaN, 10)).toBe(false);
  });

  it("неизвестный счётчик не гасит оценку", () => {
    expect(hasRating(4.5, null)).toBe(true);
    expect(hasRating(4.5, undefined)).toBe(true);
  });
});

describe("formatRating", () => {
  it("форматирует настоящий рейтинг", () => {
    expect(formatRating(4.87, 10)).toBe("4.9");
    expect(formatRating(5, 3)).toBe("5.0");
  });

  it("прочерк вместо мнимого 5.0 у нового пользователя", () => {
    expect(formatRating(5, 0)).toBe("—");
  });

  it("прочерк вместо 0.0 после удаления последнего отзыва", () => {
    expect(formatRating(0, 0)).toBe("—");
  });

  it("клампит выход за границы контракта", () => {
    expect(formatRating(7, 1)).toBe("5.0");
    expect(formatRating(-3, 1)).toBe("0.0");
  });
});
