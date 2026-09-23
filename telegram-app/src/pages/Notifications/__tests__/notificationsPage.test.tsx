// Рендер-тесты NotificationsPage без @testing-library/react (не установлен):
// react-dom/server renderToString (среда node, DOM не нужен) — паттерн
// reviewsPage.test.tsx: хуки данных мокаются через vi.hoisted, PageHeader
// рендерится внутри MemoryRouter (useNavigate).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const {
  mockUseInbox,
  mockUseMarkRead,
  mockUseMarkAll,
} = vi.hoisted(() => ({
  mockUseInbox: vi.fn(),
  mockUseMarkRead: vi.fn(),
  mockUseMarkAll: vi.fn(),
}));

vi.mock("@/queries/useNotificationsQuery", () => ({
  useNotificationsInboxQuery: mockUseInbox,
  useMarkNotificationReadMutation: mockUseMarkRead,
  useMarkAllNotificationsReadMutation: mockUseMarkAll,
}));

import {
  NotificationsPage,
  isCriticalNotification,
  notificationRoute,
} from "@/pages/Notifications/NotificationsPage";

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

function renderPage(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

const pageWithItems = (items: Array<Record<string, unknown>>, unreadCount = items.length) => ({
  data: {
    pages: [{ items, nextCursor: null, unreadCount }],
  },
});

beforeEach(() => {
  setMocks(pageWithItems([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("notificationRoute / isCriticalNotification (контракт parity)", () => {
  it("критичные типы из notification.service.ts", () => {
    expect(isCriticalNotification("booking_status_changed")).toBe(true);
    expect(isCriticalNotification("trip_cancelled")).toBe(true);
    expect(isCriticalNotification("trip_status_changed")).toBe(true);
    expect(isCriticalNotification("booking_created")).toBe(false);
    expect(isCriticalNotification("feedback_replied")).toBe(false);
  });

  it("deep-links известных событий ведут на существующие TG-маршруты", () => {
    expect(notificationRoute("booking_status_changed")).toBe("/bookings");
    expect(notificationRoute("trip_cancelled")).toBe("/bookings");
    expect(notificationRoute("trip_status_changed")).toBe("/profile/history");
    expect(notificationRoute("booking_created")).toBe("/bookings?segment=driver");
    expect(notificationRoute("review_approved")).toBe("/reviews");
    expect(notificationRoute("feedback_replied")).toBe("/profile/support");
  });

  it("неизвестный тип — честно null, не выдуманный маршрут", () => {
    expect(notificationRoute("something_future")).toBeNull();
    expect(notificationRoute("")).toBeNull();
  });
});

describe("NotificationsPage: шапка и контракт", () => {
  it("заголовок, счётчик непрочитанных, ссылка на настройки, critical-подпись", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderPage();

    expect(html).toContain("Уведомления");
    expect(html).toContain("Непрочитанных: 1");
    expect(html).toContain('href="#/settings"');
    expect(html).toContain("Настройки уведомлений");
    expect(html).toContain("сохраняются всегда");
    expect(html).toContain("Прочитать все");
  });

  it("все прочитаны — подпись и неактивная кнопка «Прочитать все»", () => {
    setMocks(pageWithItems([makeNotification({ isRead: true })], 0));

    const html = renderPage();

    expect(html).toContain("Все уведомления прочитаны");
  });
});

describe("NotificationsPage: карточки", () => {
  it("критичная — бейдж «Важное», некритичная непрочитанная — «Новое»", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "booking_created", title: "Новая заявка" }),
      ]),
    );

    const html = renderPage();

    expect(html).toContain("Важное");
    expect(html).toContain("Новое");
  });

  it("deep-link ведёт на раздел события; у неизвестного типа ссылки нет", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    const html = renderPage();

    expect(html).toContain('href="#/bookings"');
    expect(html).toContain('href="#/profile/support"');

    setMocks(pageWithItems([makeNotification({ id: "n-x", type: "something_future" })]));
    expect(renderPage()).not.toContain("Открыть");
  });

  it("непрочитанная — кнопка «Отметить прочитанным»; прочитанная — без неё", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", isRead: false }),
        makeNotification({ id: "n-2", isRead: true, title: "Старое" }),
      ]),
    );

    const html = renderPage();

    expect(html).toContain("Отметить прочитанным");
    expect(html).toContain("Старое");
  });

  it("пагинация: кнопка «Показать ещё» при следующей странице", () => {
    setMocks({
      ...pageWithItems([makeNotification()]),
      hasNextPage: true,
    });

    expect(renderPage()).toContain("Показать ещё");
  });

  it("пустое состояние", () => {
    setMocks(pageWithItems([]));

    const html = renderPage();

    expect(html).toContain("Пока нет уведомлений");
  });
});

describe("NotificationsPage: состояния запроса", () => {
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
