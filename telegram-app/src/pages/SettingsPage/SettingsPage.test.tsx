// Рендер-тесты SettingsPage — паттерн supportPage.test.tsx (renderToString,
// моки хуков через vi.hoisted, MemoryRouter для PageHeader/useNavigate).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseProfile, mockUseSave } = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseSave: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
  useProfileNotificationSettingsMutation: mockUseSave,
}));

import { SettingsPage } from "./SettingsPage";

function profileState(overrides: Record<string, unknown> = {}) {
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

function setMocks(
  profile: Record<string, unknown> = {},
  save: Record<string, unknown> = {},
) {
  mockUseProfile.mockReturnValue(profileState(profile));
  mockUseSave.mockReturnValue(mutationState(save));
}

function renderPage(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks({ data: { notificationsEnabled: true } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsPage: тумблер уведомлений", () => {
  it("включены — статус и кнопка выключения", () => {
    setMocks({ data: { notificationsEnabled: true } });

    const html = renderPage();

    expect(html).toContain("Уведомления включены");
    expect(html).toContain("Выключить некритичные");
  });

  it("выключены — статус и кнопка включения", () => {
    setMocks({ data: { notificationsEnabled: false } });

    const html = renderPage();

    expect(html).toContain("Некритичные уведомления выключены");
    expect(html).toContain("Включить уведомления");
  });

  it("навигация: уведомления и назад в профиль", () => {
    const html = renderPage();

    expect(html).toContain("Открыть уведомления");
    expect(html).toContain("Назад в профиль");
  });

  it("pending мутации — кнопки заблокированы", () => {
    setMocks({ data: { notificationsEnabled: true } }, { isPending: true });

    const html = renderPage();

    expect(html).toContain("disabled");
  });
});

describe("SettingsPage: состояния запроса", () => {
  it("loading — спиннер", () => {
    setMocks({ data: undefined, isLoading: true });

    expect(renderPage()).toContain('aria-label="Загрузка"');
  });

  it("ошибка — повтор", () => {
    setMocks({ isError: true, error: new Error("Нет соединения") });

    const html = renderPage();

    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("пусто (нет данных) — текст настроек", () => {
    setMocks({ data: undefined });

    const html = renderPage();

    expect(html).toContain("Пока пусто");
    expect(html).toContain("Не удалось загрузить настройки.");
  });
});
