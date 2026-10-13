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
import uiStyles from "@/ui/ui.module.css";

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

describe("Тело попапа: без Placeholder, тексты в плашках", () => {
  // Раньше тело было `Placeholder` — компонентом ПУСТОГО состояния: он
  // центрирует содержимое и набирает заголовок крупным кеглем, из-за чего
  // попап читался как «данных нет» и весь шёл сплошняком. Теперь обычная
  // колонка, а свободные тексты (жалоба, ответ модерации) стоят в плашках
  // `ui/Blockquote`: фон, полоса слева, сохранённые переносы.
  it("не рисует Placeholder — это компонент пустого состояния", () => {
    // Китовая обёртка Placeholder (tgui-f23c0e195677169c в styles.css).
    expect(renderBody()).not.toContain("tgui-f23c0e195677169c");
  });

  it("не рисует img — жалоба это текст, а не иллюстрация", () => {
    expect(renderBody()).not.toContain("<img");
  });

  it("категория и тип видны", () => {
    const html = renderBody(report({ category: "spam", targetType: "user" }));
    expect(html).toContain("Спам · Пользователь");
  });

  it("текст жалобы лежит в плашке-цитате", () => {
    // Пин именно факта плашки: без неё текст снова станет обычным абзацем
    // рядом со служебными строками (тот самый «сплошняк»).
    const html = renderBody(report({ description: "Опасное вождение" }));
    expect(html).toContain(uiStyles.quote as string);
  });

  it("ответ модерации — тоже плашка, со своим тоном", () => {
    const html = renderBody(
      report({ status: "rejected", resolutionNote: "Нарушений не найдено." }),
    );
    // Плашки две: жалоба и ответ; у ответа тон warning (исход «отклонена»).
    expect(html.split(uiStyles.quote as string).length - 1).toBe(2);
    expect(html).toContain('data-tone="warning"');
  });

  it("у ответа модерации тон соответствует исходу жалобы", () => {
    const html = renderBody(
      report({ status: "resolved", resolutionNote: "Аккаунт заблокирован." }),
    );
    expect(html).toContain('data-tone="success"');
  });

  it("статус виден и в попапе, а не только в строке ленты", () => {
    expect(renderBody(report({ status: "resolved" }))).toContain("Закрыта");
  });

  it("время ответа у закрытой жалобы: дата и сколько ждали", () => {
    const html = renderBody(
      report({
        status: "resolved",
        createdAt: "2026-09-10T10:00:00.000Z",
        resolvedAt: "2026-09-10T16:00:00.000Z",
      }),
    );
    expect(html).toContain("Ответ 10.09.2026 · через 6 ч");
  });

  it("пока жалоба в работе, строки ответа нет", () => {
    // resolvedAt при возврате в in_review обнуляется сервером, поэтому
    // строка не просто приглушена, а отсутствует.
    expect(
      renderBody(report({ status: "in_review", resolvedAt: null })),
    ).not.toContain("Ответ ");
  });

  it("переносы строк жалобы сохраняются", () => {
    // Описание — свободный текст пользователя; без pre-wrap переносы
    // склеились бы в кашу (правило живёт в ui/Blockquote).
    expect(
      renderBody(report({ description: "строка 1\nстрока 2" })),
    ).toContain("строка 1\nстрока 2");
  });
});
