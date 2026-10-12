// Чистые форматтеры строки жалобы (reportPreview.ts) — проверяются без DOM,
// паттерн reportValidation.test / searchFilters.test.
//
// Контракт подписок строки зафиксирован намеренно: его видят и читатель
// ленты, и скринридер, поэтому первая строка всегда «категория, тип», а
// вторая — начало описания.
import { describe, expect, it } from "vitest";
import {
  reportCellAriaLabel,
  reportPreviewSubtitle,
  reportPreviewTitle,
  reportStatusTone,
} from "@/pages/Reports/reportPreview";
import type { Report } from "@edem/contracts";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    targetType: "trip",
    targetId: "t-1",
    category: "safety",
    description: "Опасное вождение",
    status: "pending",
    resolutionNote: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("reportPreviewTitle: строка 1", () => {
  it("категория и тип объекта через точку", () => {
    expect(reportPreviewTitle(report())).toBe("Безопасность · Поездка");
    expect(
      reportPreviewTitle(report({ category: "spam", targetType: "user" })),
    ).toBe("Спам · Пользователь");
  });

  it("непусто для любой комбинации", () => {
    const categories = [
      "safety",
      "fraud",
      "harassment",
      "spam",
      "inaccurate_info",
      "other",
    ] as const;
    const types = ["user", "trip", "booking"] as const;
    for (const category of categories) {
      for (const targetType of types) {
        expect(
          reportPreviewTitle(report({ category, targetType })).trim(),
        ).not.toBe("");
      }
    }
  });
});

describe("reportPreviewSubtitle: строка 2", () => {
  it("возвращает описание как есть — обрезку делает кит", () => {
    // Своей обрезки нет намеренно: вторая реализация со временем
    // разъехалась бы с китной.
    const long = "а".repeat(500);
    expect(reportPreviewSubtitle(report({ description: long }))).toBe(long);
  });

  it("хвостовые пробелы срезаются", () => {
    expect(reportPreviewSubtitle(report({ description: "  Опасное  " }))).toBe(
      "Опасное",
    );
  });

  it("пустое описание прячет строку, а не рисует пробел", () => {
    // Кит прячет пустые строки (как у уведомлений) — отдаём undefined.
    expect(reportPreviewSubtitle(report({ description: "" }))).toBeUndefined();
    expect(reportPreviewSubtitle(report({ description: "   " }))).toBeUndefined();
  });
});

describe("reportStatusTone", () => {
  it("тон по статусу модерации", () => {
    expect(reportStatusTone("pending")).toBe("warning");
    expect(reportStatusTone("in_review")).toBe("info");
    expect(reportStatusTone("resolved")).toBe("success");
    expect(reportStatusTone("rejected")).toBe("danger");
  });
});

describe("reportCellAriaLabel", () => {
  it("называет категорию, тип, статус и само действие", () => {
    const label = reportCellAriaLabel(report());
    expect(label).toContain("Безопасность");
    expect(label).toContain("Поездка");
    expect(label).toContain("Ожидает рассмотрения");
    // Без «открыть подробности» скринридер читает только содержимое строки
    // и не знает, что тап что-то делает.
    expect(label).toContain("открыть подробности");
  });

  it("меняет статус вместе с модерацией", () => {
    expect(reportCellAriaLabel(report({ status: "rejected" }))).toContain(
      "Отклонена",
    );
  });
});
