// Рендер-тесты раздела «Поездки»: сегменты Активные/История/За рулём,
// фильтр истории, водительские заявки и guards destructive-действий,
// ошибки мутаций. База активного сегмента покрыта в tripsPages.test.tsx
// «TripsPage parity» — здесь не дублируется.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseHistory.mockReturnValue(queryState({ data: [] }));
  mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
  mockUseCancelBooking.mockReturnValue(mutation());
  mockUseCancelTrip.mockReturnValue(mutation());
  mockUseCompleteTrip.mockReturnValue(mutation());
});

const {
  mockUseMyBookings,
  mockUseHistory,
  mockUseInfiniteMyTrips,
  mockUseCancelBooking,
  mockUseCancelTrip,
  mockUseCompleteTrip,
} = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  usePassengerHistoryQuery: mockUseHistory,
  useCancelBookingMutation: mockUseCancelBooking,
  useTripBookingsQuery: vi.fn(),
  useUpdateBookingStatusMutation: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: mockUseCompleteTrip,
  };
});

import { TripsPage } from "@/pages/TripsPage";
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

function infiniteState(items: unknown[], overrides: Record<string, unknown> = {}) {
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

function render(element: ReactNode, url = "/bookings"): string {
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
      id: "u-me",
      name: "Я",
      rating: 5,
      reviewsCount: 1,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    ...overrides,
  };
}

describe("TripsPage history", () => {
  it("сегмент из URL: все статусы без вложенного фильтра", () => {
    mockUseHistory.mockReturnValue(
      queryState({
        data: [
          {
            id: "h-1",
            seat: 1,
            status: "confirmed",
            historyCategory: "completed",
            trip: makeTrip({ id: "t-h1" }),
          },
          {
            id: "h-2",
            seat: 1,
            status: "cancelled",
            historyCategory: "cancelled",
            trip: makeTrip({ id: "t-h2" }),
          },
        ],
      }),
    );
    const html = render(<TripsPage />, "/bookings?segment=history");
    expect(html).not.toContain("Фильтр истории");
    expect(html).toContain("Поездка завершена");
    expect(html).toContain("Поездка отменена");
  });

  it("пустая история — плейсхолдер", () => {
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    const html = render(<TripsPage />, "/bookings?segment=history");
    expect(html).toContain("Здесь появятся завершённые и отменённые поездки.");
  });
});

describe("TripsPage driver", () => {
  it("поездка водителя: бейдж, места, цена и guards", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 2 })]),
    );
    const html = render(<TripsPage />, "/bookings?segment=driver");
    expect(html).toContain("Вы водитель");
    expect(html).toContain("Заявки: 2");
    expect(html).toContain("Ожидают решения: 2");
    expect(html).toContain("Управление поездкой");
    expect(html).toContain("Завершить");
    expect(html).toContain("Отменить");
    expect(html).toContain("+ Создать поездку");
  });

  it("завершённая поездка — без destructive-кнопок", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ status: "completed" })]),
    );
    const html = render(<TripsPage />, "/bookings?segment=driver");
    expect(html).toContain("Завершена");
    expect(html).not.toContain("Завершить");
  });

  it("пусто — плейсхолдер (кнопка создания внутри ленты, её нет)", () => {
    mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
    const html = render(<TripsPage />, "/bookings?segment=driver");
    expect(html).toContain("Пока пусто");
    expect(html).toContain("Пока тихо");
  });
});

describe("TripsPage mutation errors", () => {
  it("ошибка отмены брони — FormError с понятным текстом", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            seat: 1,
            status: "confirmed",
            trip: makeTrip(),
          },
        ],
      }),
    );
    mockUseCancelBooking.mockReturnValue(
      mutation({ error: new Error("network down") }),
    );
    const html = render(<TripsPage />);
    expect(html).toContain('role="alert"');
  });
});
