import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
  hasExistingReport,
  isReportCategory,
  isReportTargetType,
  reportErrorMessage,
  validateReportForm,
} from "@/pages/Reports/reportValidation";

describe("report guards (рантайм вместо cast из DOM)", () => {
  it("категории: известные проходят, мусор отсекается", () => {
    expect(isReportCategory("safety")).toBe(true);
    expect(isReportCategory("other")).toBe(true);
    expect(isReportCategory("xss")).toBe(false);
    expect(isReportCategory("")).toBe(false);
  });

  it("типы объектов: user/trip/booking, мусор отсекается", () => {
    expect(isReportTargetType("trip")).toBe(true);
    expect(isReportTargetType("admin")).toBe(false);
  });

  it("подписи покрывают все категории/статусы/типы контракта", () => {
    expect(Object.keys(REPORT_CATEGORY_LABELS)).toHaveLength(6);
    expect(REPORT_CATEGORY_LABELS.safety).toBe("Безопасность");
    expect(Object.keys(REPORT_TARGET_TYPE_LABELS)).toHaveLength(3);
    expect(REPORT_STATUS_LABELS.pending).toBe("Ожидает рассмотрения");
    expect(REPORT_STATUS_LABELS.in_review).toBe("На рассмотрении");
    expect(REPORT_STATUS_LABELS.resolved).toBe("Рассмотрена");
    expect(REPORT_STATUS_LABELS.rejected).toBe("Отклонена");
  });
});

describe("validateReportForm", () => {
  it("пустой id объекта и пустое описание отклоняются", () => {
    expect(validateReportForm("", "описание")).toBe(
      "Укажите идентификатор объекта жалобы",
    );
    expect(validateReportForm("t-1", "")).toBe("Опишите проблему");
    expect(validateReportForm("t-1", "   ")).toBe("Опишите проблему");
  });

  it("описание сверх 2000 отклоняется, граница проходит", () => {
    expect(validateReportForm("t-1", "d".repeat(2001))).toContain("2000");
    expect(validateReportForm("t-1", "d".repeat(2000))).toBeNull();
  });
});

describe("hasExistingReport (клиентский хинт «1 жалоба навсегда»)", () => {
  const mine = [
    { targetType: "trip" as const, targetId: "t-1" },
    { targetType: "user" as const, targetId: "u-9" },
  ];

  it("та же тройка (тип+id) — дубликат", () => {
    expect(hasExistingReport(mine, "trip", "t-1")).toBe(true);
    // id нормализуется тримом перед сравнением
    expect(hasExistingReport(mine, "trip", "  t-1  ")).toBe(true);
  });

  it("другой тип/id — не дубликат; пустой id — не дубликат", () => {
    expect(hasExistingReport(mine, "trip", "t-2")).toBe(false);
    expect(hasExistingReport(mine, "booking", "t-1")).toBe(false);
    expect(hasExistingReport(mine, "trip", "   ")).toBe(false);
    expect(hasExistingReport([], "trip", "t-1")).toBe(false);
  });
});

describe("reportErrorMessage (conflict/forbidden/rate-limit/validation)", () => {
  it("409 CONFLICT — жалоба уже существует", () => {
    expect(
      reportErrorMessage(new ApiError("exists", "CONFLICT", 409)),
    ).toContain("Жалоба уже отправлена");
  });

  it("403 FORBIDDEN — нет связи с объектом", () => {
    expect(
      reportErrorMessage(new ApiError("denied", "FORBIDDEN", 403)),
    ).toContain("Жалоба недоступна");
  });

  it("429 — с ожиданием из retryAfterMs", () => {
    expect(
      reportErrorMessage(new ApiError("slow", "RATE_LIMITED", 429, 60_000)),
    ).toContain("60 с");
  });

  it("400 — серверная санитизация", () => {
    expect(
      reportErrorMessage(new ApiError("bad", "VALIDATION_FAILED", 400)),
    ).toContain("Проверьте введённые данные");
  });

  it("401 — нужна авторизация", () => {
    expect(reportErrorMessage(new ApiError("auth", undefined, 401))).toContain(
      "авторизация",
    );
  });

  it("не-Error — дефолтный текст", () => {
    expect(reportErrorMessage(undefined)).toBe("Не удалось отправить жалобу");
  });
});
