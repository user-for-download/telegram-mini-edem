// SSR-тесты тела попапа жалобы (`ReportDetailsBody`).
//
// Тело экспортируется отдельно от `ReportDetailsModal` намеренно: Modal кита
// — портал, в renderToString не попадает (тот же приём, что у
// `TripRequestsBody` в TripRequestsModal).
//
// Смысл проверок прежнего теста списка сохранён: ответ модерации и полный
// текст жалобы ОБЯЗАНЫ где-то показываться, просто теперь в попапе.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

import { ReportDetailsBody } from "@/pages/Reports/ReportDetailsModal";

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

function renderBody(r: Report = report()): string {
  return renderToString(
    <AppRoot platform="base">
      <ReportDetailsBody report={r} />
    </AppRoot>,
  );
}

describe("ReportDetailsBody: содержимое попапа", () => {
  it("показывает категорию, тип и статус жалобы", () => {
    const html = renderBody(report({ status: "in_review", category: "spam" }));
    expect(html).toContain("Спам · Поездка");
    expect(html).toContain("На рассмотрении");
  });

  it("дата подачи по Москве", () => {
    expect(renderBody()).toContain("09.09.2026");
  });

  it("полный текст жалобы, а не обрезанная строка", () => {
    // В списке описание сжато китной обрезкой до одной строки, поэтому
    // длинный текст обязан сохраниться целиком здесь.
    const long = "Опасное вождение. ".repeat(50);
    expect(renderBody(report({ description: long }))).toContain(
      "Опасное вождение.",
    );
  });

  it("ответ модерации показан, когда он есть", () => {
    const html = renderBody(
      report({
        status: "resolved",
        resolutionNote: "Бронь отменена, аккаунт заблокирован.",
      }),
    );
    expect(html).toContain("Ответ модерации");
    expect(html).toContain("Бронь отменена, аккаунт заблокирован.");
  });

  it("ответ модерации для отклонённой жалобы — тоже", () => {
    const html = renderBody(
      report({
        status: "rejected",
        resolutionNote: "Нарушений не найдено, жалоба отклонена.",
      }),
    );
    expect(html).toContain("Нарушений не найдено, жалоба отклонена.");
  });

  it("без ответа модерации блока нет", () => {
    expect(renderBody()).not.toContain("Ответ модерации");
  });
});

describe("Тело попапа: Placeholder без картинки", () => {
  // Жалоба — короткий текст со статусом, а не иллюстрация: картинка в
  // Placeholder читалась бы как «данных нет». Раньше здесь была своя вёрстка
  // (шапка + пилюля + Notice), которая выглядела тяжелее самой сути.
  it("не рисует img — слот картинки Placeholder пустой", () => {
    expect(renderBody()).not.toContain("<img");
  });

  it("категория и тип уехали в заголовок Placeholder", () => {
    const html = renderBody(report({ category: "spam", targetType: "user" }));
    expect(html).toContain("Спам · Пользователь");
  });

  it("статус виден и в попапе, а не только в пилюле-заглушке", () => {
    expect(renderBody(report({ status: "resolved" }))).toContain("Рассмотрена");
  });

  it("переносы строк жалобы сохраняются", () => {
    // Описание — свободный текст пользователя; без pre-wrap переносы
    // склеились бы в кашу.
    expect(
      renderBody(report({ description: "строка 1\nстрока 2" })),
    ).toContain("строка 1\nстрока 2");
  });
});
