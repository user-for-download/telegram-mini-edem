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
  DRIVER_NOTIFICATION_TYPES,
  PASSENGER_NOTIFICATION_TYPES,
  isCriticalNotification,
  normalizeNotifSegment,
  notifSegmentOf,
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

function renderPageAt(url = "/"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <NotificationsPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

function renderPage(): string {
  return renderPageAt("/");
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
    // booking_created — новая заявка водителю → сегмент «Заявки».
    expect(notificationRoute("booking_created")).toBe("/bookings?segment=requests");
    expect(notificationRoute("review_approved")).toBe("/reviews");
    expect(notificationRoute("feedback_replied")).toBe("/profile/support");
  });

  it("неизвестный тип — честно null, не выдуманный маршрут", () => {
    expect(notificationRoute("something_future")).toBeNull();
    expect(notificationRoute("")).toBeNull();
  });
});

describe("NotificationsPage: шапка и контракт", () => {
  it("пилюли сегментов + IconButton «Прочитать все» со счётчиком", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderPage();

    expect(html).toContain("Уведомления");
    expect(html).toContain("Новые");
    expect(html).toContain("Водитель");
    expect(html).toContain("Пассажир");
    expect(html).toContain("Фильтр уведомлений");
    // IconButton: имя со счётчиком (кнопки «Прочитать все» больше нет).
    expect(html).toContain('aria-label="Прочитать все (1)"');
    expect(html).not.toContain("Настройки уведомлений");
    expect(html).not.toContain("сохраняются всегда");
  });

  it("все прочитаны — IconButton неактивна, имя без счётчика", () => {
    setMocks(pageWithItems([makeNotification({ isRead: true })], 0));

    const html = renderPage();

    expect(html).toContain('aria-label="Все уведомления прочитаны"');
    expect(html).toContain("Пока нет уведомлений");
  });
});

describe("NotificationsPage: карточки", () => {
  it("критичная — callout «Важное», некритичная непрочитанная — «Новое»", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "booking_created", title: "Новая заявка" }),
      ]),
    );

    const html = renderPage();

    expect(html).toContain("Важное");
    expect(html).toContain("Новое");
    // callout читается раньше заголовка (статус над title): видимый header —
    // последнее вхождение title (первое — aria-label баннера в атрибутах).
    expect(html.indexOf("Важное")).toBeLessThan(html.lastIndexOf("Бронь подтверждена"));
    expect(html.indexOf("Новое")).toBeLessThan(html.lastIndexOf("Новая заявка"));
  });

  it("прочитанная некритичная — без callout; иконка декоративна", () => {
    setMocks(
      pageWithItems([
        makeNotification({
          id: "n-1",
          type: "booking_created",
          isRead: true,
          title: "Прочитанная заявка",
        }),
        makeNotification({
          id: "n-2",
          type: "feedback_replied",
          isRead: true,
          title: "Прочитанный ответ",
        }),
      ], 0),
    );

    // Прочитанные не в «Новых» — смотрим в ролевом сегменте.
    const html = renderPageAt("/notifications?segment=driver");

    expect(html).toContain("Прочитанная заявка");
    expect(html).not.toContain("Новое");
    expect(html).not.toContain("Важное");
    // Иконка before декоративна: смысл дублирует callout текстом.
    expect(html).toContain('aria-hidden="true"');
  });

  it("тап по баннеру ведёт на раздел события; у неизвестного типа — только прочтение", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    const html = renderPage();

    // Баннер — кнопка: имя содержит title + действие (кнопок «Открыть» больше нет).
    expect(html).toContain('aria-label="Бронь подтверждена. Отметить прочитанным и открыть"');
    expect(html).toContain('aria-label="Ответ поддержки. Отметить прочитанным и открыть"');
    expect(html).toContain('data-testid="notification-banner-n-1"');
    expect(html).not.toContain("Открыть</");
    expect(html).not.toContain("Отметить прочитанным</");

    setMocks(pageWithItems([makeNotification({ id: "n-x", type: "something_future" })]));
    const unknown = renderPage();
    expect(unknown).toContain('aria-label="Бронь подтверждена. Отметить прочитанным"');
    expect(unknown).not.toContain("Открыть");
  });

  it("прочитанная с маршрутом — «Открыть»; без маршрута и прочитанная — не кнопка", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", isRead: true }),
        makeNotification({ id: "n-2", isRead: true, type: "something_future", title: "Старое" }),
      ], 0),
    );

    // Прочитанные — в ролевом сегменте («Новые» показывают только unread).
    const html = renderPageAt("/notifications?segment=passenger");

    expect(html).toContain('aria-label="Бронь подтверждена. Открыть"');
    expect(html).not.toContain("Старое");
    // Только один role=button: прочитанная без маршрута и не в карте — статична.
    expect(html.match(/role="button"/g)?.length ?? 0).toBe(1);
    expect(html).not.toContain("Отметить прочитанным");
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

describe("NotificationsPage: сегменты", () => {
  it("normalizeNotifSegment: driver/passenger, остальное — unread", () => {
    expect(normalizeNotifSegment("driver")).toBe("driver");
    expect(normalizeNotifSegment("passenger")).toBe("passenger");
    expect(normalizeNotifSegment(null)).toBe("unread");
    expect(normalizeNotifSegment("unread")).toBe("unread");
    expect(normalizeNotifSegment("all")).toBe("unread");
    expect(normalizeNotifSegment("requests")).toBe("unread");
    expect(normalizeNotifSegment("")).toBe("unread");
  });

  it("карта type→role: водительские, пассажирские, нейтраль — нигде", () => {
    expect(notifSegmentOf("booking_created")).toBe("driver");
    expect(notifSegmentOf("ride_request_match")).toBe("driver");
    expect(notifSegmentOf("booking_status_changed")).toBe("passenger");
    expect(notifSegmentOf("trip_cancelled")).toBe("passenger");
    expect(notifSegmentOf("trip_status_changed")).toBe("passenger");
    expect(notifSegmentOf("trip_details_changed")).toBe("passenger");
    expect(notifSegmentOf("review_approved")).toBeNull();
    expect(notifSegmentOf("feedback_replied")).toBeNull();
    expect(notifSegmentOf("something_future")).toBeNull();
    // Карты не пересекаются.
    for (const type of DRIVER_NOTIFICATION_TYPES) {
      expect(PASSENGER_NOTIFICATION_TYPES.has(type)).toBe(false);
    }
  });

  it("«Новые» — только непрочитанные всех типов (нейтраль не теряется)", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_created" }),
        makeNotification({ id: "n-2", type: "booking_created", isRead: true, title: "Прочитанная заявка" }),
        makeNotification({ id: "n-3", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    const html = renderPageAt("/notifications");

    expect(html).toContain("Бронь подтверждена");
    expect(html).toContain("Ответ поддержки");
    expect(html).not.toContain("Прочитанная заявка");
  });

  it("ролевые сегменты фильтруют по карте, включая прочитанные", () => {
    const items = [
      makeNotification({ id: "n-1", type: "booking_created", title: "Заявка водителя" }),
      makeNotification({ id: "n-2", type: "booking_status_changed", isRead: true, title: "Статус пассажира" }),
      makeNotification({ id: "n-3", type: "review_approved", title: "Отзыв принят" }),
    ];
    setMocks(pageWithItems(items));

    const driver = renderPageAt("/notifications?segment=driver");
    expect(driver).toContain("Заявка водителя");
    expect(driver).not.toContain("Статус пассажира");
    expect(driver).not.toContain("Отзыв принят");

    const passenger = renderPageAt("/notifications?segment=passenger");
    expect(passenger).toContain("Статус пассажира");
    expect(passenger).not.toContain("Заявка водителя");
    expect(passenger).not.toContain("Отзыв принят");
  });

  it("пустые сегменты — свои тексты; чипы с aria-pressed", () => {
    setMocks(pageWithItems([makeNotification({ id: "n-1", type: "booking_created", title: "Заявка водителя" })]));

    const driver = renderPageAt("/notifications?segment=driver");
    expect(driver).toContain("Заявка водителя");
    expect(driver).toContain('aria-pressed="true"');

    // В пассажирском та же заявка не видна — свой empty-текст.
    const passenger = renderPageAt("/notifications?segment=passenger");
    expect(passenger).toContain("Нет уведомлений пассажира");
    expect(passenger).toContain("Подтверждения, отмены и изменения поездок появятся здесь");

    // Пустой инбокс в водительском — свой empty-текст.
    setMocks(pageWithItems([]));
    const emptyDriver = renderPageAt("/notifications?segment=driver");
    expect(emptyDriver).toContain("Нет уведомлений водителя");
    expect(emptyDriver).toContain("Заявки пассажиров и совпадения запросов появятся здесь");
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
