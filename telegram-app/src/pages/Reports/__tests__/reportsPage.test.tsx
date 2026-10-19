// Рендер-тесты ReportsPage — паттерн reviewsPage.test.tsx (renderToString,
// моки хуков через vi.hoisted, MemoryRouter для PageHeader).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const here = dirname(fileURLToPath(import.meta.url));

const { mockUseMine, mockUseCreate } = vi.hoisted(() => ({
  mockUseMine: vi.fn(),
  mockUseCreate: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", () => ({
  useMyReportsQuery: mockUseMine,
  useCreateReportMutation: mockUseCreate,
}));

import { ReportsPage } from "@/pages/Reports/ReportsPage";

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}) {
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

function setMocks(mine: Record<string, unknown> = {}) {
  mockUseMine.mockReturnValue(queryState({ data: [], ...mine }));
  mockUseCreate.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
}

function renderPage(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReportsPage: форма — во всплывающем окне", () => {
  it("под «Мои жалобы» есть кнопка «Подать жалобу»", () => {
    expect(renderPage()).toContain("Подать жалобу");
  });

  it("самой формы на странице нет — она в окне (портал в SSR не попадает)", () => {
    // Регресс на возврат к форме во весь экран: страница отвечает за список
    // и ответы модерации, форма — в ComplaintModal.
    const html = renderPage();

    expect(html).not.toContain("Сообщите о проблеме");
    expect(html).not.toContain('id="report-target"');
    expect(html).not.toContain('id="report-description"');
  });

  it("кнопка создания идёт после списка, а не до него", () => {
    const html = renderPage();
    expect(html.indexOf("Мои жалобы")).toBeLessThan(
      html.indexOf("Подать жалобу"),
    );
  });
});

describe("ReportsPage: мои жалобы", () => {
  it("пустое состояние с подсказкой про право жаловаться", () => {
    const html = renderPage();

    expect(html).toContain("Вы пока не отправляли жалоб");
    expect(html).toContain("На свою поездку");
  });

  it("статусы и категории подписаны по-русски", () => {
    setMocks({
      data: [
        report({ status: "pending" }),
        report({
          id: "223e4567-e89b-12d3-a456-426614174001",
          status: "in_review",
          category: "spam",
          description: "Спам в чате",
        }),
        report({
          id: "323e4567-e89b-12d3-a456-426614174002",
          status: "resolved",
          category: "fraud",
          description: "Мошенничество",
        }),
        report({
          id: "423e4567-e89b-12d3-a456-426614174003",
          status: "rejected",
          category: "other",
          description: "Прочее",
        }),
      ],
    });

    const html = renderPage();

    expect(html).toContain("Ожидает рассмотрения");
    expect(html).toContain("На рассмотрении");
    expect(html).toContain("Закрыта");
    expect(html).toContain("Отклонена");
    expect(html).toContain("Опасное вождение");
    expect(html).toContain("Спам в чате");
  });

  it("ответ модерации уехал из строки в попап", () => {
    // Строка списка сжата до трёх строк (как уведомление): развёрнутый
    // ответ модерации раздавливал ленту, поэтому в списке его нет, а в
    // попапе — есть. Тело попапа проверяется отдельно (reportDetails.test).
    setMocks({
      data: [
        report({
          status: "resolved",
          resolutionNote: "Бронь отменена, аккаунт заблокирован.",
        }),
      ],
    });

    const html = renderPage();

    expect(html).toContain("Безопасность · Поездка");
    expect(html).not.toContain("Ответ модерации");
    expect(html).not.toContain("Бронь отменена, аккаунт заблокирован.");
    // Дата в строке есть — правая колонка Info, как у уведомлений.
    expect(html).toContain("09.09.2026");
  });

});

describe("ReportsPage: состояния запроса", () => {
  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderPage()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderPage();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("403 (бан mid-session) — терминальный экран вместо общей ошибки", () => {
    setMocks({
      isError: true,
      error: new ApiError("Forbidden", "FORBIDDEN", 403),
    });

    expect(renderPage()).toContain("Аккаунт заблокирован");
  });
});

// Заголовок строки переносится, а не обрезается: на одну строку в раскладке
// с датой приходится 193px (~21 знак), и системная подпись «Оскорбления ·
// Пользователь» (222px) читалась как «Оскорбления · Пользо…». Кит ставит
// заголовку `nowrap` всегда — значит, перенос это наше правило, и его легко
// снести, не заметив (в HTML класс хэширован, поэтому ловим текстом CSS —
// прецедент `notificationsVisual.test.ts`). Класс спана китный: живость
// хэша в ките стережёт kitContract, оба правила — здесь (реестр #57).
describe("строка жалобы: заголовок в две строки, описание и статус — в одну", () => {
  it("CSS: заголовку снят nowrap и поставлен line-clamp: 2", () => {
    const css = readFileSync(
      join(here, "..", "ReportsPage.module.css"),
      "utf8",
    );
    const rule = css.match(
      /\.cell\.cell :global\(\.tgui-1c6d7865a76a19bc\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(rule, "правило переноса заголовка пропало").toBeTruthy();
    expect(rule).toContain("-webkit-line-clamp: 2");
    expect(rule).toContain("white-space: normal");
  });
});
