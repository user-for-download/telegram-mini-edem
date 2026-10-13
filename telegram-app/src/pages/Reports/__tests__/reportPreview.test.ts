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
  reportResponseLine,
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

describe("reportResponseLine: когда и как быстро закрыли", () => {
  // Разница считается между двумя ISO-строки (когда подали → когда ответили),
  // а не «сейчас минус ответ»: закрытая месяц назад жалоба показала бы
  // «прошло 30 дней», что человеку ничего не сообщает — его волнует, сколько
  // он ЖДАЛ. Дата ответа — по Москве, как все даты жалобы (app.md, §4).
  it("дата ответа по Москве и интервал ожидания", () => {
    // 10:00Z = 13:00 МСК, ответ 16:00Z = 19:00 МСК → 6 ч.
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-10T16:00:00.000Z",
        }),
      ),
    ).toBe("Ответ 10.09.2026 · через 6 ч");
  });

  it("минуты без целого часа", () => {
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-10T10:45:00.000Z",
        }),
      ),
    ).toBe("Ответ 10.09.2026 · через 45 мин");
  });

  it("ответ в другой день — интервал считается, дата берётся ответа", () => {
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-11T11:30:00.000Z",
        }),
      ),
    ).toBe("Ответ 11.09.2026 · через 1 день 1 ч 30 мин");
  });

  it("сутки отдельной частью: «25 ч» читалось бы как ошибка", () => {
    // Жалобу действительно ждут дни, и «через 25 ч 30 мин» этому не
    // соответствует — часы без суток выглядят как сбой счётчика.
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-13T12:00:00.000Z",
        }),
      ),
    ).toBe("Ответ 13.09.2026 · через 3 дня 2 ч");
  });

  it("ровно сутки — «1 день», без хвоста в часах", () => {
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-11T10:00:00.000Z",
        }),
      ),
    ).toBe("Ответ 11.09.2026 · через 1 день");
  });

  it("у жалобы в работе строки нет", () => {
    // pending/in_review: resolvedAt обнулён сервером при возврате в работу.
    expect(reportResponseLine(report())).toBe("");
    expect(
      reportResponseLine(report({ status: "in_review", resolvedAt: null })),
    ).toBe("");
  });

  it("отклонённая показывает время ответа так же", () => {
    // resolvedAt ставится для обоих терминальных статусов
    // (backend/src/reports/index.ts), значит строка обязана быть и здесь.
    expect(
      reportResponseLine(
        report({
          status: "rejected",
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-10T12:00:00.000Z",
        }),
      ),
    ).toBe("Ответ 10.09.2026 · через 2 ч");
  });

  it("мусор на входе даёт пустую строку, а не «через -3 ч»", () => {
    // Непонятная подпись хуже отсутствия: знак «минус» читается как баг.
    expect(
      reportResponseLine(
        report({
          createdAt: "2026-09-10T10:00:00.000Z",
          resolvedAt: "2026-09-10T07:00:00.000Z",
        }),
      ),
    ).toBe("");
    expect(reportResponseLine(report({ resolvedAt: "мусор" }))).toBe("");
  });
});
