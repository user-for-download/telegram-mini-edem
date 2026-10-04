// Рендер-тесты NotificationsPage без @testing-library/react (не установлен):
// react-dom/server renderToString (среда node, DOM не нужен) — паттерн
// reviewsPage.test.tsx: хуки данных мокаются через vi.hoisted, PageHeader
// рендерится внутри MemoryRouter (useNavigate).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";

const {
  mockUseInbox,
  mockUseUnreadCount,
  mockUseMarkRead,
  mockUseMarkAll,
} = vi.hoisted(() => ({
  mockUseInbox: vi.fn(),
  mockUseUnreadCount: vi.fn(),
  mockUseMarkRead: vi.fn(),
  mockUseMarkAll: vi.fn(),
}));

vi.mock("@/queries/useNotificationsQuery", () => ({
  useNotificationsInboxQuery: mockUseInbox,
  useUnreadCountQuery: mockUseUnreadCount,
  useMarkNotificationReadMutation: mockUseMarkRead,
  useMarkAllNotificationsReadMutation: mockUseMarkAll,
}));

import {
  NotificationsPage,
  formatNotifTime,
  formatNotificationWho,
  formatTripDetail,
  normalizeNotifSegment,
  notificationActionLabel,
  notificationRoute,
  notificationTarget,
} from "@/pages/Notifications/NotificationsPage";
import { NOTIFICATION_ROLE_TYPES } from "@edem/contracts";

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    userId: "u-1",
    type: "booking_status_changed",
    title: "Бронь подтверждена",
    body: "Водитель подтвердил вашу заявку",
    isRead: false,
    deepLink: null,
    actorName: null,
    action: null,
    tripFrom: null,
    tripTo: null,
    tripPrice: null,
    tripDepartureAt: null,
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

function setMocks(inbox: Record<string, unknown> = {}, counter?: number) {
  mockUseInbox.mockReturnValue(infiniteState(inbox));
  mockUseUnreadCount.mockReturnValue({
    data: counter,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
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

describe("notificationRoute (контракт parity)", () => {
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

describe("notificationTarget: deepLink важнее fallback-карты", () => {
  it("серверный per-entity deepLink приоритетен", () => {
    expect(
      notificationTarget({ type: "trip_cancelled", deepLink: "/trips/uuid" }),
    ).toBe("/trips/uuid");
  });

  it("без deepLink — типовая карта разделов", () => {
    expect(notificationTarget({ type: "trip_cancelled", deepLink: null })).toBe(
      "/bookings",
    );
    expect(notificationTarget({ type: "trip_cancelled" })).toBe("/bookings");
  });

  it("без deepLink и типа — null (пассивная строка)", () => {
    expect(
      notificationTarget({ type: "something_future", deepLink: null }),
    ).toBeNull();
  });
});

describe("formatNotifTime / notificationAcronym", () => {
  it("сегодня — ЧЧ:ММ (TZ-независимо)", () => {
    expect(formatNotifTime(new Date().toISOString())).toMatch(/^\d{2}:\d{2}$/);
  });

  it("старая дата — короткий день без времени, битая — как есть", () => {
    expect(formatNotifTime("2020-01-15T10:00:00.000Z")).toContain("2020");
    expect(formatNotifTime("мусор")).toBe("мусор");
  });

  it("словарь действий: глаголы по коду, неизвестное — null", () => {
    expect(notificationActionLabel("confirmed")).toBe("подтвердил");
    expect(notificationActionLabel("cancelled")).toBe("отменил");
    expect(notificationActionLabel("created")).toBe("отправил заявку");
    expect(notificationActionLabel(null)).toBeNull();
    expect(notificationActionLabel(undefined)).toBeNull();
    expect(notificationActionLabel("something_future")).toBeNull();
  });

  it("formatNotificationWho: «фио • действие» одной строкой", () => {
    expect(formatNotificationWho("Дарья Петрова", "отправил заявку")).toBe(
      "Дарья Петрова • отправил заявку",
    );
    expect(formatNotificationWho("Дарья Петрова", null)).toBe("Дарья Петрова");
    expect(formatNotificationWho(null, "отменил")).toBe("отменил");
    expect(formatNotificationWho(null, null)).toBeNull();
  });

  it("formatTripDetail: «дата, время • цена • маршрут»", () => {
    const detail = formatTripDetail({
      from: "Вологда",
      to: "Череповец",
      price: 500,
      departureAt: "2020-09-10T09:00:00.000Z",
    });
    expect(detail).toContain("500 ₽");
    expect(detail).toContain("Вологда → Череповец");
    expect(detail).toContain("2020");
    expect(
      formatTripDetail({ from: null, to: null, price: null, departureAt: null }),
    ).toBeNull();
    expect(
      formatTripDetail({
        from: "Вологда",
        to: null,
        price: null,
        departureAt: "мусор",
      }),
    ).toBe("Вологда");
  });
});

describe("NotificationsPage: шапка и контракт", () => {
  it("пилюли сегментов + IconButton «Прочитать все» со счётчиком", () => {
    // Счётчик задаётся ЯВНО (глобальный unread-count). Раньше число
    // подставлялось фолбэком из page[0].unreadCount сегментного ответа —
    // это и был B9.
    setMocks(pageWithItems([makeNotification()], 1), 1);

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

  it("счётчик неизвестен — имя без числа и без ложного «все прочитаны»", () => {
    // Второй аргумент setMocks не передан, поэтому глобальный счётчик
    // НЕизвестен (данных нет), а 0 относится к сегментному счёту inbox.
    // Утверждать «Все уведомления прочитаны» при неизвестном счётчике нельзя
    // — это ложь о состоянии, которого приложение не знает (N-02).
    setMocks(pageWithItems([], 0));

    const html = renderPage();

    expect(html).toContain('aria-label="Прочитать все"');
    expect(html).not.toContain("Все уведомления прочитаны");
    expect(html).not.toContain("Прочитать все (0)");
    expect(html).toContain("Пока нет уведомлений");
  });

  it("нулевой счётчик — единственное состояние, где можно сказать «все прочитаны»", () => {
    // Контрпарный к предыдущему: число известно и равно нулю, тогда
    // утверждение правдиво, и кнопка гаснет.
    setMocks(pageWithItems([]), 0);

    const html = renderPage();

    expect(html).toContain('aria-label="Все уведомления прочитаны"');
  });
});

describe("NotificationsPage: карточки", () => {
  it("критичная — без слова «Важное», только три строки", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "booking_created", title: "Новая заявка" }),
      ]),
    );

    const html = renderPage();

    expect(html).not.toContain("Важное");
    expect(html).not.toContain("Новое");
    // Непрочитанное состояние — dot-бейдж (тип number не используется).
    expect(html).toContain('data-testid="notification-unread-n-1"');
    expect(html).toContain('data-testid="notification-unread-n-2"');
  });

  it("три строки: событие / «фио • действие» / «дата • цена • маршрут»", () => {
    setMocks(
      pageWithItems([
        makeNotification({
          id: "n-1",
          title: "Новая заявка",
          actorName: "Дарья Петрова",
          action: "created",
          tripFrom: "Вологда",
          tripTo: "Череповец",
          tripPrice: 500,
          tripDepartureAt: "2026-09-10T09:00:00.000Z",
        }),
      ]),
    );

    const html = renderPage();

    expect(html).toContain("Новая заявка");
    expect(html).toContain("Дарья Петрова • отправил заявку");
    expect(html).toContain("500 ₽");
    expect(html).toContain("Вологда → Череповец");
    expect(html).toContain(
      'aria-label="Новая заявка. Дарья Петрова • отправил заявку.',
    );
  });

  it("без actor/action — строки скрыты, имя прежнее", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderPage();

    expect(html).toContain(
      'aria-label="Бронь подтверждена. Отметить прочитанным и открыть"',
    );
  });

  it("строка без аватара: только время справа", () => {
    setMocks(pageWithItems([makeNotification()]));

    const html = renderPage();

    // Аватара нет (раньше был акроним ">БР<").
    expect(html).not.toContain(">БР<");
    // Время — вторая строка штатного Info (текст зависит от TZ,
    // фикстура сентябрьская — месяц стабилен в любом TZ).
    expect(html).toContain("сент");
  });

  it("прочитанная некритичная — без статусов и без dot", () => {
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
    expect(html).not.toContain("notification-unread-");
    // Шеврон декоративен: смысл дублирует aria-label ячейки.
    expect(html).toContain('aria-hidden="true"');
  });

  it("тап по ячейке ведёт на раздел события; у неизвестного типа — только прочтение", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    const html = renderPage();

    // Ячейка интерактивна (type="button"): имя содержит title + действие
    // (кнопок «Открыть» больше нет).
    expect(html).toContain('aria-label="Бронь подтверждена. Отметить прочитанным и открыть"');
    expect(html).toContain('aria-label="Ответ поддержки. Отметить прочитанным и открыть"');
    expect(html).toContain('data-testid="notification-cell-n-1"');
    expect(html).not.toContain("Открыть</");
    expect(html).not.toContain("Отметить прочитанным</");

    setMocks(pageWithItems([makeNotification({ id: "n-x", type: "something_future" })]));
    const unknown = renderPage();
    expect(unknown).toContain('aria-label="Бронь подтверждена. Отметить прочитанным"');
    expect(unknown).not.toContain("Открыть");
  });

  it("прочитанная с маршрутом — «Открыть» и шеврон; без маршрута — пассивна", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", isRead: true }),
        makeNotification({ id: "n-2", isRead: true, type: "something_future", title: "Старое" }),
      ], 0),
    );

    // Сервер уже отфильтровал архив: клиент показывает обе как есть.
    const html = renderPageAt("/notifications?segment=passenger");

    expect(html).toContain('aria-label="Бронь подтверждена. Открыть"');
    expect(html).toContain("Старое");
    // Две ячейки: интерактивная (с маршрутом) и пассивная без aria-label.
    expect(html.match(/data-testid="notification-cell-/g)?.length ?? 0).toBe(2);
    expect(html).not.toContain("Отметить прочитанным");
  });

  it("интерактивная ячейка — role=button + tabindex (M2), пассивная — без", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_status_changed" }),
        makeNotification({ id: "n-2", isRead: true, type: "something_future", title: "Старое" }),
      ], 1),
    );

    const html = renderPage();

    // n-1 непрочитана с маршрутом: кнопочная семантика для клавиатуры/SR.
    // n-2 пассивна (прочитана, без маршрута): ни role, ни tabindex, ни label.
    expect(html.match(/role="button"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('aria-label="Старое');
  });

  it("пагинация: кнопка «Показать ещё» при следующей странице", () => {
    setMocks({
      ...pageWithItems([makeNotification()]),
      hasNextPage: true,
    });

    expect(renderPage()).toContain("Показать ещё");
  });

  it("M1: пустой сегмент при hasNextPage — всё равно «Показать ещё»", () => {
    setMocks({
      ...pageWithItems([]),
      hasNextPage: true,
    });

    const html = renderPage();
    expect(html).toContain("Пока нет уведомлений");
    expect(html).toContain("Показать ещё");
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

  it("карта type→role: единый источник в контрактах (m3)", () => {
    // booking_created — водитель; match — автор запроса (пассажир);
    // trip_status_changed — оба (водителю о своей, пассажирам об их);
    // нейтраль — нигде (только «Новые», пока непрочитана).
    expect(NOTIFICATION_ROLE_TYPES.driver.has("booking_created")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.driver.has("trip_status_changed")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("ride_request_match")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("booking_status_changed")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("trip_cancelled")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("trip_status_changed")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("trip_details_changed")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.driver.has("ride_request_match")).toBe(false);
    expect(NOTIFICATION_ROLE_TYPES.driver.has("review_approved")).toBe(false);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("review_approved")).toBe(false);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("feedback_replied")).toBe(false);
  });

  it("клиент не фильтрует по типам: показывает всё, что вернул сервер", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_created" }),
        makeNotification({ id: "n-2", type: "booking_created", isRead: true, title: "Прочитанная заявка" }),
        makeNotification({ id: "n-3", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    // Фильтр — серверный (?role=/unreadOnly): «Новые» с сервера уже только
    // непрочитанные, клиент ничего не выкидывает сам.
    const html = renderPageAt("/notifications");

    expect(html).toContain("Бронь подтверждена");
    expect(html).toContain("Ответ поддержки");
    expect(html).toContain("Прочитанная заявка");
  });

  it("сегмент уходит в хук: сервер отдаёт архив, клиент его не трогает", () => {
    const items = [
      makeNotification({ id: "n-1", type: "booking_created", title: "Заявка водителя" }),
      makeNotification({ id: "n-2", type: "booking_status_changed", isRead: true, title: "Статус пассажира" }),
      makeNotification({ id: "n-3", type: "review_approved", title: "Отзыв принят" }),
    ];
    setMocks(pageWithItems(items));

    const driver = renderPageAt("/notifications?segment=driver");
    expect(mockUseInbox).toHaveBeenCalledWith(20, "driver");
    expect(driver).toContain("Заявка водителя");
    expect(driver).toContain("Статус пассажира");
    expect(driver).toContain("Отзыв принят");

    const passenger = renderPageAt("/notifications?segment=passenger");
    expect(mockUseInbox).toHaveBeenCalledWith(20, "passenger");
    expect(passenger).toContain("Заявка водителя");
    expect(passenger).toContain("Статус пассажира");
    expect(passenger).toContain("Отзыв принят");
  });

  it("пустые сегменты — свои тексты; чипы с aria-pressed", () => {
    setMocks(pageWithItems([]));

    const driver = renderPageAt("/notifications?segment=driver");
    expect(driver).toContain("Нет уведомлений водителя");
    expect(driver).toContain("Заявки пассажиров и совпадения запросов появятся здесь");
    expect(driver).toContain('aria-pressed="true"');

    // Пустой инбокс в пассажирском — свой empty-текст.
    const passenger = renderPageAt("/notifications?segment=passenger");
    expect(passenger).toContain("Нет уведомлений пассажира");
    expect(passenger).toContain("Подтверждения, отмены и изменения поездок появятся здесь");
  });
});

describe("NotificationsPage: ролевые архивы (item 10, m3)", () => {
  it("архив «Водитель» рендерит ровно строки сервера, без клиентского фильтра", () => {
    // Сервер отдал в архив смешанные строки (включая прочитанные и тип
    // вне клиентских карт) — клиент рисует все как есть, по типам не фильтрует.
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_created", title: "Заявка водителя" }),
        makeNotification({ id: "n-2", type: "booking_status_changed", isRead: true, title: "Статус пассажира" }),
        makeNotification({ id: "n-3", type: "something_future", title: "Тип вне карт клиента" }),
      ]),
    );

    const html = renderPageAt("/notifications?segment=driver");

    expect(mockUseInbox).toHaveBeenCalledWith(20, "driver");
    expect(html).toContain("Заявка водителя");
    expect(html).toContain("Статус пассажира");
    expect(html).toContain("Тип вне карт клиента");
  });

  it("легаси-строки (без роли) рендерятся через серверный fallback — клиент их не отсекает", () => {
    // Легаси (recipientRole null) попадает в архив только по серверной
    // type-карте NOTIFICATION_ROLE_TYPES; клиент о роли не знает и не фильтрует.
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "booking_created", title: "Легаси-заявка" }),
      ]),
    );

    const html = renderPageAt("/notifications?segment=driver");

    expect(html).toContain("Легаси-заявка");
  });

  it("архив «Пассажир»: тип вне клиентских карт рендерится, если сервер его вернул", () => {
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "ride_request_match", title: "Совпадение запроса" }),
        makeNotification({ id: "n-2", type: "something_future", title: "Будущий тип" }),
      ]),
    );

    const html = renderPageAt("/notifications?segment=passenger");

    expect(mockUseInbox).toHaveBeenCalledWith(20, "passenger");
    expect(html).toContain("Совпадение запроса");
    expect(html).toContain("Будущий тип");
  });

  it("нейтральный тип от сервера тоже рендерится (клиент архивные строки не фильтрует)", () => {
    // feedback_replied — нейтральный (архивного дома нет по контракту), но
    // если сервер вернул строку — клиент обязан её показать.
    setMocks(
      pageWithItems([
        makeNotification({ id: "n-1", type: "feedback_replied", title: "Ответ поддержки" }),
      ]),
    );

    const html = renderPageAt("/notifications?segment=driver");

    expect(html).toContain("Ответ поддержки");
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

describe("NotificationsPage: бейдж — авторитетный счётчик unread-count", () => {
  it("IconButton показывает значение counter-запроса, а не page[0]", () => {
    setMocks(pageWithItems([makeNotification()], 7), 3);

    expect(renderPage()).toContain('aria-label="Прочитать все (3)"');
  });

  it("нулевой счётчик гасит кнопку, даже если page[0] врёт", () => {
    setMocks(pageWithItems([makeNotification()], 2), 0);

    const html = renderPage();
    expect(html).toContain('aria-label="Все уведомления прочитаны"');
    expect(html).not.toContain("Прочитать все (");
  });

  it("без счётчика (первая загрузка) — число не подставляется", () => {
    // Пока глобальный счётчик не пришёл, число неизвестно. Сегментный
    // page[0].unreadCount = 1 к делу не относится (B9) — кнопка помечает
    // прочитанными ВСЁ, а не только архив. И «все прочитаны» тоже нельзя:
    // это утверждение о непрочитанных, которых мы не знаем (N-02).
    setMocks(pageWithItems([makeNotification()], 1));

    const html = renderPage();
    expect(html).toContain('aria-label="Прочитать все"');
    expect(html).not.toContain("Все уведомления прочитаны");
    expect(html).not.toContain("Прочитать все (1)");
  });

  it("счётчик живёт в aria-live: анонс имени/числа без смены механики", () => {
    setMocks(pageWithItems([makeNotification()], 7), 3);

    const html = renderPage();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Прочитать все (3)"');
  });
});

describe("notifications cache: read/read-all правят ОБА кэша", () => {
  async function realQueries() {
    return vi.importActual<
      typeof import("@/queries/useNotificationsQuery")
    >("@/queries/useNotificationsQuery");
  }

  function seedClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  }

  it("markRead: список + счётчик декрементируются, если запись была непрочитанной", async () => {
    const { applyMarkReadCaches, NOTIFICATION_KEYS } = await realQueries();
    const client = seedClient();
    const inboxKey = [...NOTIFICATION_KEYS.inbox(20, "unread")];
    client.setQueryData(inboxKey, {
      pages: [
        {
          items: [makeNotification({ id: "n-1", isRead: false })],
          nextCursor: null,
          unreadCount: 1,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 5);

    const decremented = applyMarkReadCaches(client, "n-1", {
      isRead: true,
    });

    expect(decremented).toBe(true);
    const inbox = client.getQueryData(inboxKey) as {
      pages: Array<{ items: Array<{ isRead: boolean }>; unreadCount: number }>;
    };
    expect(inbox.pages[0]?.items[0]?.isRead).toBe(true);
    expect(inbox.pages[0]?.unreadCount).toBe(0);
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(4);
  });

  it("markRead: уже прочитанная запись — ни список, ни счётчик не двигаются", async () => {
    const { applyMarkReadCaches, NOTIFICATION_KEYS } = await realQueries();
    const client = seedClient();
    const inboxKey = [...NOTIFICATION_KEYS.inbox(20, "unread")];
    client.setQueryData(inboxKey, {
      pages: [
        {
          items: [makeNotification({ id: "n-1", isRead: true })],
          nextCursor: null,
          unreadCount: 0,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 5);

    const decremented = applyMarkReadCaches(client, "n-1", {
      isRead: true,
    });

    expect(decremented).toBe(false);
    const inbox = client.getQueryData(inboxKey) as {
      pages: Array<{ unreadCount: number }>;
    };
    expect(inbox.pages[0]?.unreadCount).toBe(0);
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(5);
  });

  it("markAllRead: все записи гаснут, счётчик — в 0", async () => {
    const { applyMarkAllReadCaches, NOTIFICATION_KEYS } = await realQueries();
    const client = seedClient();
    const inboxKey = [...NOTIFICATION_KEYS.inbox(20, "unread")];
    client.setQueryData(inboxKey, {
      pages: [
        {
          items: [
            makeNotification({ id: "n-1", isRead: false }),
            makeNotification({ id: "n-2", isRead: false }),
          ],
          nextCursor: null,
          unreadCount: 2,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 2);

    applyMarkAllReadCaches(client);

    const inbox = client.getQueryData(inboxKey) as {
      pages: Array<{ items: Array<{ isRead: boolean }>; unreadCount: number }>;
    };
    expect(inbox.pages[0]?.items.every((item) => item.isRead)).toBe(true);
    expect(inbox.pages[0]?.unreadCount).toBe(0);
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(0);
  });
});

describe("notification keys: узкий набор для WS-хинта", () => {
  it("счётчик и префикс списков — узкие потомки all; inbox вложен в lists", async () => {
    const { NOTIFICATION_KEYS } = await vi.importActual<
      typeof import("@/queries/useNotificationsQuery")
    >("@/queries/useNotificationsQuery");

    // Хинт notification:new инвалидирует только эти два ключа — blanket all
    // для него запрещён (ловим регресс расширения набора).
    expect([...NOTIFICATION_KEYS.unreadCount()]).toEqual([
      "notifications",
      "unread-count",
    ]);
    expect([...NOTIFICATION_KEYS.lists()]).toEqual(["notifications", "inbox"]);
    const inboxKey = [...NOTIFICATION_KEYS.inbox(20, "unread")];
    expect(inboxKey.slice(0, 2)).toEqual([...NOTIFICATION_KEYS.lists()]);
    // Ключ счётчика — число, он НЕ под lists: list-патчи его не задевают.
  });
});


/* B8 (время по Москве) вынесен в notificationsTime.tz.test.ts: там
 * принудительно ставится TZ, отличная от московской, — на московской
 * машине баг неотличим от корректного поведения. */

describe("счётчик «Прочитать все»: сегмент не протекает (B9)", () => {
  /** Сегментный ответ с unreadCount архива (для вьюпорт — это не глобальное число). */
  function segmentInbox(unreadCount: number) {
    return infiniteState({
      data: {
        pages: [
          {
            items: [makeNotification({ id: "n-1", isRead: false })],
            nextCursor: null,
            unreadCount,
          },
        ],
      },
    });
  }

  it("непрочитанные в архиве водителя НЕ попадают в число на кнопке", () => {
    // Сегментный unreadCount = 7, глобальный счётчик ещё грузится
    // (data === undefined). Показать «Прочитать все (7)» нельзя: это
    // число непрочитанных ТОЛЬКО в водительском архиве, а действие
    // помечает прочитанными всё. И «все прочитаны» нельзя: счётчик
    // ещё не пришёл, то есть неизвестен (N-02).
    mockUseInbox.mockReturnValue(segmentInbox(7));
    mockUseUnreadCount.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPageAt("/?segment=driver");

    expect(html).not.toContain("Прочитать все (7)");
    expect(html).toContain('aria-label="Прочитать все"');
    expect(html).not.toContain("Все уведомления прочитаны");
  });

  it("глобальный счётчик отражается в кнопке, сегментный игнорируется", () => {
    mockUseInbox.mockReturnValue(segmentInbox(7));
    mockUseUnreadCount.mockReturnValue({
      data: 12,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPageAt("/?segment=driver");

    expect(html).toContain("Прочитать все (12)");
    expect(html).not.toContain("Прочитать все (7)");
  });

  it("сбой счётчика: лента жива, кнопка рабочая, ложного «все прочитаны» нет", () => {
    // Замер 2026-10-03 (N-02): GET /notifications/unread-count → 500 давал
    // «Все уведомления прочитаны» и disabled при 9 непрочитанных.
    mockUseInbox.mockReturnValue(segmentInbox(9));
    mockUseUnreadCount.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("counter unavailable", "UNAVAILABLE", 500),
      refetch: vi.fn(),
    });

    const html = renderPageAt("/?segment=driver");

    // Лента — независимый запрос, она на месте.
    expect(html).toContain("Бронь подтверждена");
    // Счётчик неизвестен → никаких выдуманных чисел.
    expect(html).toContain('aria-label="Прочитать все"');
    expect(html).not.toContain("Все уведомления прочитаны");
    expect(html).not.toContain("Прочитать все (");
    // Частичный сбой: плашка с ретраем, а не QueryState на весь экран —
    // лента при сбое счётчика остаётся в силе.
    expect(html).toContain("Не удалось загрузить счётчик непрочитанных");
    expect(html).toContain("Повторить");
    expect(html).toContain('role="alert"');
  });
});
