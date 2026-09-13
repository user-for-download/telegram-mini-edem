// SSR-тесты NotificationsBody (тело route-backed модалки /notifications).
// Modal — портал и в renderToString не попадает, поэтому тестируется
// экспортированное тело. Паттерн notificationsPage.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const { mockUseInbox, mockUseMarkRead, mockUseMarkAll } = vi.hoisted(() => ({
  mockUseInbox: vi.fn(),
  mockUseMarkRead: vi.fn(),
  mockUseMarkAll: vi.fn(),
}));

vi.mock("@/queries/useNotificationsQuery", () => ({
  useNotificationsInboxQuery: mockUseInbox,
  useMarkNotificationReadMutation: mockUseMarkRead,
  useMarkAllNotificationsReadMutation: mockUseMarkAll,
}));

import { NotificationsBody } from "@/components/NotificationsModal";

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    userId: "u-1",
    type: "booking_status_changed",
    title: "Бронь подтверждена",
    body: "Водитель подтвердил вашу заявку",
    isRead: false,
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function infiniteState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...overrides,
  };
}

function mutationState(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function setMocks(inbox: Record<string, unknown> = {}) {
  mockUseInbox.mockReturnValue(infiniteState(inbox));
  mockUseMarkRead.mockReturnValue(mutationState());
  mockUseMarkAll.mockReturnValue(mutationState());
}

const pageWithItems = (
  items: Array<Record<string, unknown>>,
  unreadCount = items.length,
) => ({
  data: {
    pages: [{ items, nextCursor: null, unreadCount }],
  },
});

function renderBody(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/notifications"]}>
        <NotificationsBody />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks(pageWithItems([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsBody: шапка и контракт", () => {
  it("счётчик непрочитанных, ссылка на настройки, critical-подпись", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderBody();

    expect(html).toContain("Непрочитанных: 1");
    expect(html).toContain('href="#/settings"');
    expect(html).toContain("Настройки уведомлений");
    expect(html).toContain("сохраняются всегда");
    expect(html).toContain("Прочитать все");
  });

  it("все прочитаны — подпись вместо счётчика", () => {
    setMocks(pageWithItems([makeNotification({ isRead: true })], 0));

    expect(renderBody()).toContain("Все уведомления прочитаны");
  });

  it("PageHeader внутрь модалки не рендерится (закрытие — header модалки)", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderBody();

    // PageHeader — header с Title level=1; в теле модалки его нет.
    expect(html).not.toContain("pt-5 pb-3");
  });
});

describe("NotificationsBody: карточки", () => {
  it("критичная — бейдж «Важное», некритичная непрочитанная — «Новое»", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({
          id: "n-2",
          type: "booking_created",
          title: "Новая заявка",
        }),
      ]),
    );

    const html = renderBody();

    expect(html).toContain("Важное");
    expect(html).toContain("Новое");
  });

  it("deep-link ведёт на раздел события; у неизвестного типа ссылки нет", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({
          id: "n-2",
          type: "feedback_replied",
          title: "Ответ поддержки",
        }),
      ]),
    );

    const html = renderBody();

    expect(html).toContain('href="#/bookings"');
    expect(html).toContain('href="#/profile/support"');

    setMocks(
      pageWithItems([makeNotification({ id: "n-x", type: "something_future" })]),
    );
    expect(renderBody()).not.toContain("Открыть");
  });

  it("непрочитанная — кнопка «Отметить прочитанным»; прочитанная — без неё", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", isRead: false }),
        makeNotification({ id: "n-2", isRead: true, title: "Старое" }),
      ]),
    );

    const html = renderBody();

    expect(html).toContain("Отметить прочитанным");
    expect(html).toContain("Старое");
  });

  it("пагинация: кнопка «Показать ещё» при следующей странице", () => {
    setMocks({
      ...pageWithItems([makeNotification()]),
      hasNextPage: true,
    });

    expect(renderBody()).toContain("Показать ещё");
  });

  it("пустой список — пустое состояние", () => {
    setMocks(pageWithItems([]));

    const html = renderBody();

    expect(html).toContain("Пока нет уведомлений");
    expect(html).toContain("Подтверждения брони");
  });
});

describe("NotificationsBody: a11y", () => {
  it("секция с именем, live-регионы, таргеты ≥44px", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderBody();

    expect(html).toContain('aria-label="Уведомления"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Список уведомлений"');
    expect(html).toContain("min-h-[44px]");
  });
});

describe("NotificationsBody: состояния запроса", () => {
  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("403 (бан mid-session) — терминальный экран вместо общей ошибки", () => {
    setMocks({
      isError: true,
      error: new ApiError("Forbidden", "FORBIDDEN", 403),
    });

    expect(renderBody()).toContain("Аккаунт заблокирован");
  });
});
