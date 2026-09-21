// SSR-тесты P0-сентинела (list-perf-01): renderToString списков с
// useInfiniteSentinel — паттерн SearchPage.test.tsx (node, без DOM).
// Среда node: IntersectionObserver отсутствует — рендер обязан не падать,
// контент виден сразу, работает fallback-кнопка «Показать ещё».
// Happy/edge: есть ещё страницы / конец списка / догрузка / ошибка.
// a11y: сентинел aria-hidden (маркер _sentinel_), скелетоны role=status
// с aria-label.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseInfiniteTrips,
  mockUseInfiniteMyTrips,
  mockUseMyBookings,
  mockUseHistory,
  mockUseCancelBooking,
  mockUseCancelTrip,
  mockUseCompleteTrip,
  mockUseInbox,
  mockUseMarkRead,
  mockUseMarkAll,
} = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  mockUseInbox: vi.fn(),
  mockUseMarkRead: vi.fn(),
  mockUseMarkAll: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteTripsQuery: mockUseInfiniteTrips,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: mockUseCompleteTrip,
  };
});

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  usePassengerHistoryQuery: mockUseHistory,
  useCancelBookingMutation: mockUseCancelBooking,
  useTripBookingsQuery: vi.fn(),
  useUpdateBookingStatusMutation: vi.fn(),
}));

vi.mock("@/queries/useNotificationsQuery", () => ({
  useNotificationsInboxQuery: mockUseInbox,
  useMarkNotificationReadMutation: mockUseMarkRead,
  useMarkAllNotificationsReadMutation: mockUseMarkAll,
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 5 } }),
}));

import { SearchPage } from "@/pages/SearchPage";
import { TripPage } from "@/pages/Trip/TripPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { ToastProvider } from "@/components/Toast/ToastProvider";

function baseQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function tripsInfinite(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ...baseQuery(),
    data: { pages: [{ items, pagination: { hasMore: false } }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function inboxInfinite(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ...baseQuery(),
    data: { pages: [{ items, nextCursor: null, unreadCount: items.length }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 125,
    distanceKm: 140,
    price: 450,
    seatsTotal: 3,
    seatsAvailable: 2,
    status: "active",
    pendingRequestsCount: 0,
    confirmedBookingsCount: 0,
    driver: {
      id: "u-1",
      name: "Александр",
      rating: 4.9,
      reviewsCount: 12,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    ...overrides,
  };
}

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

function render(element: ReactNode, url = "/trips"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(tripsInfinite([]));
  mockUseInfiniteMyTrips.mockReturnValue(tripsInfinite([]));
  mockUseMyBookings.mockReturnValue(baseQuery({ data: [] }));
  mockUseHistory.mockReturnValue(baseQuery({ data: [] }));
  mockUseCancelBooking.mockReturnValue(mutation());
  mockUseCancelTrip.mockReturnValue(mutation());
  mockUseCompleteTrip.mockReturnValue(mutation());
  mockUseInbox.mockReturnValue(inboxInfinite([]));
  mockUseMarkRead.mockReturnValue(mutation());
  mockUseMarkAll.mockReturnValue(mutation());
});

describe("SearchPage: сентинел (SSR, без IntersectionObserver)", () => {
  it("happy: контент виден сразу + сентинел + fallback-кнопка", () => {
    mockUseInfiniteTrips.mockReturnValue(
      tripsInfinite([makeTrip()], { hasNextPage: true }),
    );
    const html = render(<SearchPage />);
    // Fallback без observer: первая страница отрендерена сразу.
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    // Сентинел-якорь: aria-hidden, фиксированная высота.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("min-h-12");
    // Fallback-кнопка для SSR/без observer и клавиатуры.
    expect(html).toContain("Показать ещё");
  });

  it("edge: конец списка — ни сентинела, ни кнопки", () => {
    mockUseInfiniteTrips.mockReturnValue(
      tripsInfinite([makeTrip()], { hasNextPage: false }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Вологда");
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain("Показать ещё");
  });

  it("догрузка: скелетон с aria-label, контент не пропадает", () => {
    mockUseInfiniteTrips.mockReturnValue(
      tripsInfinite([makeTrip()], {
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Вологда");
    expect(html).toContain('aria-label="Загрузка ещё поездок"');
    expect(html).toContain('role="status"');
  });

  it("ошибка: терминальный QueryState без сентинела", () => {
    mockUseInfiniteTrips.mockReturnValue(
      tripsInfinite([], {
        data: undefined,
        isError: true,
        error: new Error("network down"),
      }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain("Показать ещё");
  });
});

describe("TripPage (active): сентинел (SSR, без IntersectionObserver)", () => {
  it("happy: сентинел + fallback-кнопка при hasNextPage", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      tripsInfinite([makeTrip()], { hasNextPage: true }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Вы водитель");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("_sentinel_");
    expect(html).toContain("Показать ещё");
  });

  it("edge: конец списка — ни сентинела, ни кнопки", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      tripsInfinite([makeTrip()], { hasNextPage: false }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Вы водитель");
    expect(html).not.toContain("_sentinel_");
    expect(html).not.toContain("Показать ещё");
  });

  it("догрузка: скелетон с aria-label", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      tripsInfinite([makeTrip()], {
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain('aria-label="Загрузка ещё поездок"');
  });
});

describe("NotificationsPage: сентинел (SSR, без IntersectionObserver)", () => {
  it("happy: контент виден сразу + сентинел + fallback-кнопка", () => {
    mockUseInbox.mockReturnValue(
      inboxInfinite([makeNotification()], { hasNextPage: true }),
    );
    const html = render(<NotificationsPage />);
    expect(html).toContain("Бронь подтверждена");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("min-h-12");
    expect(html).toContain("Показать ещё");
  });

  it("edge: конец списка — ни сентинела, ни кнопки", () => {
    mockUseInbox.mockReturnValue(
      inboxInfinite([makeNotification()], { hasNextPage: false }),
    );
    const html = render(<NotificationsPage />);
    expect(html).toContain("Бронь подтверждена");
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain("Показать ещё");
  });

  it("догрузка: скелетон с aria-label, список не пропадает", () => {
    mockUseInbox.mockReturnValue(
      inboxInfinite([makeNotification()], {
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    );
    const html = render(<NotificationsPage />);
    expect(html).toContain("Бронь подтверждена");
    expect(html).toContain('aria-label="Загрузка ещё уведомлений"');
  });

  it("ошибка: терминальный QueryState без сентинела", () => {
    mockUseInbox.mockReturnValue(
      inboxInfinite([], {
        data: undefined,
        isError: true,
        error: new Error("Нет соединения"),
      }),
    );
    const html = render(<NotificationsPage />);
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain("Показать ещё");
  });
});
