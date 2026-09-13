// SSR-тесты ReportsBody (тело route-backed модалки /profile/reports).
// Modal — портал и в renderToString не попадает, поэтому тестируется
// экспортированное тело. Паттерн pages/__tests__/reportsPage.test.tsx
// (SSR, моки хуков через vi.hoisted, без testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const { mockUseMine, mockUseCreate } = vi.hoisted(() => ({
  mockUseMine: vi.fn(),
  mockUseCreate: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", () => ({
  useMyReportsQuery: mockUseMine,
  useCreateReportMutation: mockUseCreate,
}));

import { ReportsBody } from "@/components/ReportsModal";

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

function renderBody(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/profile/reports"]}>
        <ReportsBody />
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

describe("ReportsBody: форма без PageHeader-back (закрытие — header модалки)", () => {
  it("happy: селекты типа/категории с русскими подписями и кнопка ≥44px", () => {
    const html = renderBody();

    expect(html).toContain("Сообщите о проблеме");
    expect(html).toContain("Пользователь");
    expect(html).toContain("Поездка");
    expect(html).toContain("Бронь");
    expect(html).toContain("Безопасность");
    expect(html).toContain("Мошенничество");
    expect(html).toContain("Недостоверная информация");
    expect(html).toContain("Отправить жалобу");
    expect(html).toContain("min-h-[44px]");
  });

  it("happy: описание с браузерным maxLength 2000 из контракта", () => {
    expect(renderBody()).toMatch(/maxlength="2000"/i);
  });

  it("happy: статусы и категории списка подписаны по-русски", () => {
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

    const html = renderBody();

    expect(html).toContain("Ожидает рассмотрения");
    expect(html).toContain("На рассмотрении");
    expect(html).toContain("Рассмотрена");
    expect(html).toContain("Отклонена");
    expect(html).toContain("Опасное вождение");
    expect(html).toContain("Спам в чате");
  });

  it("edge: пустое состояние с подсказкой про право жаловаться", () => {
    const html = renderBody();

    expect(html).toContain("Вы пока не отправляли жалоб");
    expect(html).toContain("На свою поездку");
  });

  it("edge: бан mid-session — терминальный экран без формы", () => {
    setMocks({ error: new ApiError("Forbidden", "FORBIDDEN", 403) });

    const html = renderBody();

    expect(html).toContain("Аккаунт заблокирован");
    expect(html).not.toContain("Сообщите о проблеме");
  });

  it("edge: loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});
