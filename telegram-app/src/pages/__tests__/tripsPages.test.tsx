// Рендер-тесты страниц поездок/броней: TripPage — только активные
// (TripActivePage), история отдельно (TripHistoryPage.test.tsx),
// счётчики заявок водителя, confirm-guards, фильтры поиска. Паттерн
// reviewsPage.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

// Дефолты для всех моков-хуков: пустые данные, чтобы каждый тест
// переопределял только то, что проверяет.
beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
  mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseHistory.mockReturnValue(queryState({ data: [] }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseCancelTrip.mockReturnValue(mutation());
  mockUseCompleteTrip.mockReturnValue(mutation());
  mockUseCancelBooking.mockReturnValue(mutation());
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue(mutation());
});

const {
  mockUseInfiniteTrips,
  mockUseInfiniteMyTrips,
  mockUseCancelTrip,
  mockUseCompleteTrip,
  mockUseMyBookings,
  mockUseHistory,
  mockUseCancelBooking,
  mockUseAllCities,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
} = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
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
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 5 } }),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

import { SearchPage } from "@/pages/Search/SearchPage";
import { TripPage } from "@/pages/Trip/TripPage";
import { ToastProvider } from "@/components/Toast/ToastProvider";

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

function infiniteState(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ...queryState(),
    data: { pages: [{ items, pagination: { hasMore: false } }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function render(element: ReactNode, url = "/"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 120,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-me",
      name: "Я",
      rating: 5,
      reviewsCount: 1,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    status: "active",
    pendingRequestsCount: 2,
    confirmedBookingsCount: 1,
    ...overrides,
  };
}

describe("TripPage parity", () => {
  it("только активные, без табов; пусто — ссылка на историю", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseCancelBooking.mockReturnValue(mutation());
    const html = render(<TripPage />);
    expect(html).not.toContain("Активные");
    expect(html).not.toContain("За рулём");
    // Пусто везде → подсказка с двумя путями + кнопка истории.
    expect(html).toContain("Пока тихо");
    expect(html).toContain("История поездок");
  });

  it("shows active booking cards with guarded cancel", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            seat: 2,
            status: "pending",
            trip: makeTrip({ id: "t-9", fromCity: "Москва", toCity: "Тула" }),
          },
        ],
      }),
    );
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseCancelBooking.mockReturnValue(mutation());
    const html = render(<TripPage />);
    expect(html).toContain("Отменить");
    expect(html).toContain("На рассмотрении");
    expect(html).toContain("место №2");
  });

  it("renders driver trips with request rows and guarded actions on active", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseInfiniteMyTrips.mockReturnValue(infiniteState([makeTrip()]));
    mockUseCancelTrip.mockReturnValue(mutation());
    mockUseCompleteTrip.mockReturnValue(mutation());
    mockUseDriverRequests.mockReturnValue(
      queryState({
        data: [
          {
            id: "req-1",
            seat: 1,
            status: "pending",
            trip: { id: "t-1" },
            passenger: { name: "Пётр" },
          },
        ],
      }),
    );
    // Активные (легаси-сегмент игнорируется).
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Заявки: 2");
    // Заявки — строки с −/+ вместо «Вы водитель».
    expect(html).toContain("Пётр");
    expect(html).toContain("Принять заявку Пётр");
    expect(html).not.toContain("Вы водитель");
    // Единый футер без Управления/Завершить (детали — тап по карточке).
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Управление поездкой");
    expect(html).not.toContain("Завершить");
  });
});

describe("SearchPage parity", () => {
  it("exposes city inputs, date segments and filter entry", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toContain("Откуда (город или село)");
    expect(html).toContain("Куда (город или село)");
    expect(html).toContain("Все даты");
    expect(html).toContain("Сегодня");
    expect(html).toContain("Завтра");
    expect(html).toContain("Фильтры");
    expect(html).toContain("Ищу попутку");
    expect(html).toContain("Найти");
    expect(html).toContain("Найдено поездок");
  });

  it("applies a city preset from the URL", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(
      <SearchPage />,
      "/trips?from=Вологда&to=Череповец&segment=today",
    );
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
  });
});
