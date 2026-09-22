import { describe, expect, it } from "vitest";
import {
  REVIEW_TEXT_MAX_LENGTH,
  createReviewDtoSchema,
} from "@edem/contracts";
import {
  normalizeReviewText,
  validateReviewForm,
} from "@/pages/Reviews/reviewValidation";

describe("validateReviewForm (порт CreateReviewModal)", () => {
  it("принимает обычный комментарий", () => {
    expect(validateReviewForm("Отличная поездка, спасибо!")).toBeNull();
  });

  it("отклоняет пустой и пробельный комментарий", () => {
    expect(validateReviewForm("")).toBe("Добавьте комментарий к отзыву");
    expect(validateReviewForm("   ")).toBe("Добавьте комментарий к отзыву");
  });

  it("принимает ровно 150 символов (граница лимита)", () => {
    expect(validateReviewForm("x".repeat(REVIEW_TEXT_MAX_LENGTH))).toBeNull();
  });

  it("отклоняет 151 символ", () => {
    expect(validateReviewForm("x".repeat(REVIEW_TEXT_MAX_LENGTH + 1))).toBe(
      `Максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
    );
  });
});

describe("normalizeReviewText", () => {
  it("тримит текст перед POST /reviews", () => {
    expect(normalizeReviewText("  спасибо  ")).toBe("спасибо");
  });
});

describe("150-char лимит enforced на записи (контракт)", () => {
  it("REVIEW_TEXT_MAX_LENGTH из @edem/contracts равен 150", () => {
    expect(REVIEW_TEXT_MAX_LENGTH).toBe(150);
  });

  it("write-схема принимает ровно 150 символов", () => {
    const result = createReviewDtoSchema.safeParse({
      tripId: "t-1",
      targetUserId: "u-2",
      rating: 5,
      text: "x".repeat(REVIEW_TEXT_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("write-схема отклоняет 151 символ (тот же лимит валидирует backend)", () => {
    const result = createReviewDtoSchema.safeParse({
      tripId: "t-1",
      targetUserId: "u-2",
      rating: 5,
      text: "x".repeat(REVIEW_TEXT_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});
