// Рендер-тесты страниц поездок/броней: сегменты объединённой TripsPage,
// счётчики заявок водителя, confirm-guards, фильтры поиска, edit
// ride-request. Паттерн reviewsPage.test.tsx (SSR, без testing-library).
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
  mockUseRideRequests.mockReturnValue(queryState({ data: [] }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseCancelTrip.mockReturnValue(mutation());
  mockUseCompleteTrip.mockReturnValue(mutation());
  mockUseCancelBooking.mockReturnValue(mutation());
  mockUseCreateRideRequest.mockReturnValue(mutation());
  mockUseUpdateRideRequest.mockReturnValue(mutation());
  mockUseRideRequestStatus.mockReturnValue(mutation());
  mockUseCancelRideRequest.mockReturnValue(mutation());
  mockUseTripBookings.mockReturnValue(queryState({ data: { pages: [] } }));
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
  mockUseRideRequests,
  mockUseAllCities,
  mockUseCreateRideRequest,
  mockUseUpdateRideRequest,
  mockUseRideRequestStatus,
  mockUseCancelRideRequest,
  mockUseTripBookings,
  mockUseUpdateBookingStatus,
} = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseRideRequests: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseCreateRideRequest: vi.fn(),
  mockUseUpdateRideRequest: vi.fn(),
  mockUseRideRequestStatus: vi.fn(),
  mockUseCancelRideRequest: vi.fn(),
  mockUseTripBookings: vi.fn(),
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
  useTripBookingsQuery: mockUseTripBookings,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestsQuery: mockUseRideRequests,
  useCreateRideRequestMutation: mockUseCreateRideRequest,
  useUpdateRideRequestMutation: mockUseUpdateRideRequest,
  useRideRequestStatusMutation: mockUseRideRequestStatus,
  useCancelRideRequestMutation: mockUseCancelRideRequest,
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

import { SearchPage } from "@/pages/SearchPage";
import { TripsPage } from "@/pages/TripsPage";
import { RideRequestsPage } from "@/pages/RideRequestsPage";
import { ToastProvider } from "@/components/ToastProvider";

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

describe("TripsPage parity", () => {
  it("renders two segments on the active tab", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseCancelBooking.mockReturnValue(mutation());
    const html = render(<TripsPage />);
    expect(html).toContain("Активные");
    expect(html).toContain("История");
    expect(html).not.toContain("За рулём");
    // Пусто везде → подсказка с двумя путями.
    expect(html).toContain("Пока тихо");
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
    const html = render(<TripsPage />);
    expect(html).toContain("Детали поездки");
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
    mockUseTripBookings.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                {
                  id: "req-1",
                  seat: 1,
                  status: "pending",
                  passenger: { name: "Пётр" },
                },
              ],
            },
          ],
        },
      }),
    );
    // Легаси ?segment=driver ведёт в «Активные».
    const html = render(<TripsPage />, "/bookings?segment=driver");
    expect(html).toContain("Заявки: 2");
    // Заявки — строки с −/+ вместо «Вы водитель».
    expect(html).toContain("Пётр");
    expect(html).toContain("Принять заявку Пётр");
    expect(html).not.toContain("Вы водитель");
    // Единый футер без Управления/Завершить.
    expect(html).toContain("Детали поездки");
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Управление поездкой");
    expect(html).not.toContain("Завершить");
  });

  it("renders history entries with status labels", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            seat: 1,
            status: "confirmed",
            historyCategory: "completed",
            trip: {
              id: "trip-b-1",
              fromCity: "Москва",
              toCity: "Тула",
              date: "2030-06-01",
              time: "09:00",
              departureAt: "2030-06-01T09:00:00.000Z",
              price: 500,
              driver: { id: "u-d", name: "Иван", avatar: "https://t.me/a.png" },
            },
          },
          {
            id: "b-2",
            seat: 1,
            status: "confirmed",
            historyCategory: "cancelled",
            trip: {
              id: "trip-b-2",
              fromCity: "Тверь",
              toCity: "Тула",
              date: "2030-06-02",
              time: "10:00",
              departureAt: "2030-06-02T10:00:00.000Z",
              price: 400,
              driver: {
                id: "u-d2",
                name: "Пётр",
                avatar: "https://t.me/b.png",
              },
            },
          },
        ],
      }),
    );
    const html = render(<TripsPage />, "/bookings?segment=history");
    // Один уровень табов: чипов фильтра нет, статусы — пилюлями.
    expect(html).not.toContain("Фильтр истории");
    expect(html).toContain("Поездка завершена");
    expect(html).toContain("Поездка отменена");
    expect(html).toContain("Москва");
    expect(html).toContain("Тверь");
  });

  it("merges driver archive into history with role badge", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ id: "t-arch", status: "completed" })]),
    );
    const html = render(<TripsPage />, "/bookings?segment=history");
    expect(html).toContain("Вы водитель");
    expect(html).toContain("Завершена");
    // SSR разбивает «→» комментариями.
    expect(html).toContain("Москва");
    expect(html).toContain("Тула");
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

describe("RideRequestsPage parity", () => {
  it("exposes edit and guarded cancel for mutable requests", () => {
    mockUseRideRequests.mockReturnValue(
      queryState({
        data: [
          {
            id: "r-1",
            fromCity: { id: "c-1", name: "Москва" },
            toCity: { id: "c-2", name: "Тула" },
            earliestAt: "2030-06-01T09:00:00.000Z",
            latestAt: "2030-06-01T12:00:00.000Z",
            expiresAt: "2030-05-30T00:00:00.000Z",
            seats: 1,
            status: "active",
          },
        ],
      }),
    );
    mockUseAllCities.mockReturnValue(queryState({ data: [] }));
    mockUseCreateRideRequest.mockReturnValue(mutation());
    mockUseUpdateRideRequest.mockReturnValue(mutation());
    mockUseRideRequestStatus.mockReturnValue(mutation());
    mockUseCancelRideRequest.mockReturnValue(mutation());
    const html = render(<RideRequestsPage />);
    expect(html).toContain("Редактировать");
    expect(html).toContain("Отменить запрос");
    expect(html).toContain("Поставить на паузу");
  });
});
