// SSR-тесты SupportBody (тело route-backed модалки /profile/support).
// Modal — портал и в renderToString не попадает, поэтому тестируется
// экспортированное тело. Паттерн notificationsModal.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library). AppealForm внутри тела
// использует useAppealFeedbackMutation из того же модуля — мокается вместе.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const { mockUseMine, mockUseCreate, mockUseAppeal } = vi.hoisted(() => ({
  mockUseMine: vi.fn(),
  mockUseCreate: vi.fn(),
  mockUseAppeal: vi.fn(),
}));

vi.mock("@/queries/useSupportQuery", () => ({
  useMyFeedbacksQuery: mockUseMine,
  useCreateFeedbackMutation: mockUseCreate,
  useAppealFeedbackMutation: mockUseAppeal,
}));

import { SupportBody } from "@/components/SupportModal";

function makeFeedback(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    subject: "Не приходит уведомление",
    text: "После обновления перестали приходить уведомления",
    reply: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

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

function mutationState(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function setMocks(mine: Record<string, unknown> = {}) {
  mockUseMine.mockReturnValue(queryState(mine));
  mockUseCreate.mockReturnValue(mutationState());
  mockUseAppeal.mockReturnValue(mutationState());
}

function renderBody(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/profile/support"]}>
        <SupportBody />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SupportBody: FAQ и форма (happy)", () => {
  it("FAQ, пустое состояние обращений, форма и апелляция", () => {
    const html = renderBody();

    expect(html).toContain("Частые вопросы");
    expect(html).toContain("Как забронировать место?");
    expect(html).toContain("У вас пока нет обращений");
    expect(html).toContain("Связаться с нами");
    expect(html).toContain('id="support-subject"');
    expect(html).toContain('id="support-text"');
    expect(html).toContain("Отправить");
    expect(html).toContain("Обжалование блокировки");
  });

  it("обращения со статусом ответа: тема и бейдж «Есть ответ»", () => {
    setMocks({
      data: [
        makeFeedback(),
        makeFeedback({
          id: "f-2",
          subject: "Вопрос по оплате",
          reply: "Ответ поддержки: всё исправили",
        }),
      ],
    });

    const html = renderBody();

    expect(html).toContain("Не приходит уведомление");
    expect(html).toContain("Вопрос по оплате");
    expect(html).toContain("Есть ответ");
    expect(html).toContain('aria-label="Список обращений"');
  });

  it("PageHeader внутрь модалки не рендерится (закрытие — header модалки)", () => {
    const html = renderBody();

    // PageHeader — header с Title level=1 (классы "pt-5 pb-3"); в теле нет.
    expect(html).not.toContain("pt-5 pb-3");
  });
});

describe("SupportBody: a11y", () => {
  it("именованные секции, live-регионы, таргеты ≥44px", () => {
    setMocks({ data: [makeFeedback()] });

    const html = renderBody();

    expect(html).toContain('aria-label="Частые вопросы"');
    expect(html).toContain('aria-label="Мои обращения"');
    expect(html).toContain('aria-label="Связаться с нами"');
    expect(html).toContain('aria-label="Обжалование блокировки"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("min-h-11");
  });
});

describe("SupportBody: состояния запроса (edge/error)", () => {
  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("403 (бан mid-session) — терминальный экран с апелляцией вместо формы", () => {
    setMocks({
      isError: true,
      error: new ApiError("Forbidden", "FORBIDDEN", 403),
    });

    const html = renderBody();

    expect(html).toContain("Аккаунт заблокирован");
    expect(html).toContain("Обжалование блокировки");
    expect(html).not.toContain('id="support-subject"');
    expect(html).not.toContain("pt-5 pb-3");
  });

  it("ошибка мутации — MutationError с role=alert", () => {
    setMocks({ data: [] });
    mockUseCreate.mockReturnValue(
      mutationState({ error: new Error("Не удалось отправить обращение") }),
    );

    const html = renderBody();

    expect(html).toContain("Не удалось отправить обращение");
    expect(html).toContain('role="alert"');
  });
});
