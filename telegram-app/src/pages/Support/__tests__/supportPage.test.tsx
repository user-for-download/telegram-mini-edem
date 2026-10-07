// Рендер-тесты SupportPage — паттерн reviewsPage.test.tsx (renderToString,
// моки хуков через vi.hoisted, MemoryRouter для PageHeader).
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

import { SUPPORT_FAQ, SupportPage } from "@/pages/Support/SupportPage";

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

function feedback(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    subject: "Нет уведомления",
    text: "Не пришло подтверждение брони",
    reply: null,
    repliedAt: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function setMocks(mine: Record<string, unknown> = {}) {
  mockUseMine.mockReturnValue(queryState({ data: [], ...mine }));
  mockUseCreate.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  mockUseAppeal.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
}

function renderPage(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter>
        <SupportPage />
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

describe("SupportPage: FAQ (порт SupportPanel)", () => {
  it("пять вопросов FAQ", () => {
    expect(SUPPORT_FAQ).toHaveLength(5);

    const html = renderPage();

    expect(html).toContain("Как забронировать место?");
    expect(html).toContain("Как отменить бронь?");
    expect(html).toContain("Как оставить отзыв?");
    expect(html).toContain("Как работает подтверждение личности?");
  });

  it("пункт про личность адаптирован под Telegram (без ВКонтакте)", () => {
    const safety = SUPPORT_FAQ.find((item) => item.id === "safety");
    expect(safety?.answer).toContain("Telegram");
    expect(safety?.answer).not.toContain("ВКонтакте");
  });
});

describe("SupportPage: форма — во всплывающем окне", () => {
  it("под «Мои обращения» есть кнопка «Создать обращение»", () => {
    const html = renderPage();

    expect(html).toContain("Создать обращение");
  });

  it("самой формы на странице нет — она в окне (портал в SSR не попадает)", () => {
    // Регресс на возврат к слипшейся форме: полноэкранная форма занимала бы
    // страницу целиком, ради неё и вынесена в окно.
    const html = renderPage();

    expect(html).not.toContain('id="support-subject"');
    expect(html).not.toContain('id="support-text"');
  });
});

describe("SupportPage: мои обращения", () => {
  it("пустое состояние", () => {
    setMocks({ data: [] });

    const html = renderPage();

    expect(html).toContain("У вас пока нет обращений");
  });

  it("обращение с ответом помечено «Есть ответ»", () => {
    setMocks({
      data: [
        feedback({ id: "f-1", reply: "Разобрались, уведомление доставлено" }),
        feedback({ id: "f-2", subject: "Второй вопрос", text: "Текст второго" }),
      ],
    });

    const html = renderPage();

    expect(html).toContain("Нет уведомления");
    expect(html).toContain("Есть ответ");
    expect(html).toContain("Второй вопрос");
  });
});

describe("SupportPage: структура экрана", () => {
  it("порядок секций: FAQ → мои обращения → кнопка создания", () => {
    // FAQ первым (чаще вопрос решается справкой), потом история обращений,
    // и под ней — кнопка открытия формы в окне.
    const html = renderPage();
    expect(html.indexOf("Частые вопросы")).toBeLessThan(
      html.indexOf("Мои обращения"),
    );
    expect(html.indexOf("Мои обращения")).toBeLessThan(
      html.indexOf("Создать обращение"),
    );
  });

  it("в обычном состоянии нет формы обжалования блокировки", () => {
    // Она бессмысленна без бана и занимала целый экран; живёт на
    // терминальном экране (AuthGate) и в ветке 403 ниже.
    const html = renderPage();

    expect(html).not.toContain("Обжалование блокировки");
    expect(html).not.toContain("Отправить обжалование");
  });
});

describe("SupportPage: состояния запроса", () => {
  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderPage()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderPage();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("403 (бан mid-session) — терминальный экран плюс форма обжалования", () => {
    setMocks({
      isError: true,
      error: new ApiError("Forbidden", "FORBIDDEN", 403),
    });

    const html = renderPage();

    expect(html).toContain("Аккаунт заблокирован");
    expect(html).toContain("Отправить обжалование");
  });

  it("401 (unauthorized) — общая ошибка с повтором, не терминальный экран", () => {
    setMocks({
      isError: true,
      error: new ApiError("Unauthorized", undefined, 401),
    });

    const html = renderPage();

    expect(html).toContain("Не удалось загрузить данные");
    expect(html).not.toContain("Аккаунт заблокирован");
  });
});
