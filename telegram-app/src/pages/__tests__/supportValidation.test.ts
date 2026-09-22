import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  feedbackErrorMessage,
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/Support/supportValidation";

describe("validateSupportForm", () => {
  it("пустая тема и пустой текст отклоняются", () => {
    expect(validateSupportForm("", "текст")).toBe("Укажите тему обращения");
    expect(validateSupportForm("   ", "текст")).toBe("Укажите тему обращения");
    expect(validateSupportForm("тема", "")).toBe("Опишите проблему или вопрос");
    expect(validateSupportForm("тема", "   ")).toBe("Опишите проблему или вопрос");
  });

  it("сверхлимитные поля отклоняются (100/2000 из контракта)", () => {
    expect(validateSupportForm("s".repeat(101), "текст")).toContain("100");
    expect(validateSupportForm("тема", "t".repeat(2001))).toContain("2000");
  });

  it("граничные значения проходят", () => {
    expect(validateSupportForm("s".repeat(100), "t".repeat(2000))).toBeNull();
  });

  it("нормализация тримит поля перед POST /feedback", () => {
    expect(normalizeSupportForm("  тема  ", "  текст\n")).toEqual({
      subject: "тема",
      text: "текст",
    });
  });
});

describe("feedbackErrorMessage (санитизация/rate-limit/unauthorized)", () => {
  it("429 RATE_LIMITED — с ожиданием из retryAfterMs", () => {
    expect(
      feedbackErrorMessage(new ApiError("Too many", "RATE_LIMITED", 429, 45_000)),
    ).toContain("45 с");
  });

  it("429 без retryAfterMs — без ожидания", () => {
    const message = feedbackErrorMessage(new ApiError("Too many", "RATE_LIMITED", 429));
    expect(message).toContain("Слишком много обращений");
    expect(message).not.toContain("с.");
  });

  it("400 VALIDATION_FAILED — серверная санитизация", () => {
    expect(
      feedbackErrorMessage(new ApiError("Invalid feedback payload", "VALIDATION_FAILED", 400)),
    ).toContain("Проверьте введённые данные");
  });

  it("401 — нужна авторизация", () => {
    expect(feedbackErrorMessage(new ApiError("Unauthorized", undefined, 401))).toContain(
      "авторизация",
    );
  });

  it("403 — бан", () => {
    expect(
      feedbackErrorMessage(new ApiError("Forbidden", "FORBIDDEN", 403)),
    ).toContain("заблокирован");
  });

  it("прочие серверные ошибки — сообщение как есть", () => {
    expect(feedbackErrorMessage(new ApiError("Boom", "INTERNAL_ERROR", 500))).toBe("Boom");
  });

  it("не-Error — дефолтный текст", () => {
    expect(feedbackErrorMessage(null)).toBe("Не удалось отправить обращение");
    expect(feedbackErrorMessage(new Error("сеть"))).toBe("сеть");
  });
});
