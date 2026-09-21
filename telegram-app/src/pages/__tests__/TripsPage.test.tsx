// Рендер-тесты прод-раздела «Поездки» (TripPage → TripActivePage /
// TripHistoryPage): сегменты Активные/История из URL (?segment=),
// заявки водителя и guards destructive-действий, ошибки мутаций.
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
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue(mutation());
});

const {
  mockUseMyBookings,
  mockUseHistory,
  mockUseInfiniteMyTrips,
  mockUseCancelBooking,
  mockUseCancelTrip,
  mockUseCompleteTrip,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
} = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 5 } }),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  usePassengerHistoryQuery: mockUseHistory,
  useCancelBookingMutation: mockUseCancelBooking,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: mockUseCompleteTrip,
  };
});

import { TripPage } from "@/pages/Trip/TripPage";
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

describe("TripPage segments", () => {
  it("дефолт без ?segment — вкладка «Активные»", () => {
    const html = render(<TripPage />);
    expect(html).toContain("Активные");
    expect(html).toContain("История");
    // Пусто везде → подсказка с двумя путями.
    expect(html).toContain("Пока тихо");
  });

  it("?segment=history — вкладка «История»", () => {
    const html = render(<TripPage />, "/bookings?segment=history");
    expect(html).toContain("История");
    expect(html).toContain("Здесь появятся завершённые и отменённые поездки.");
  });

  it("легаси ?segment=driver ведёт в «Активные»", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 0 })]),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Вы водитель");
  });
});

describe("TripPage history", () => {
  it("история: строки маршрутов с ценой, без вложенного фильтра", () => {
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
            trip: makeTrip({ id: "t-h2", toCity: "Сокол" }),
          },
        ],
      }),
    );
    const html = render(<TripPage />, "/bookings?segment=history");
    expect(html).not.toContain("Фильтр истории");
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    expect(html).toContain("Сокол");
    expect(html).toContain("450");
    // Статус текстом: completed → «Завершена», cancelled → «Отменена».
    expect(html).toContain("Завершена");
    expect(html).toContain("Отменена");
  });

  it("архив водителя merged в историю простыми строками", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ id: "t-arch", status: "completed" })]),
    );
    const html = render(<TripPage />, "/bookings?segment=history");
    // История — простые Cell без карточек и бейджа «Вы водитель».
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    expect(html).toContain("Завершена");
    expect(html).not.toContain("Вы водитель");
  });

  it("пустая история — плейсхолдер", () => {
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    const html = render(<TripPage />, "/bookings?segment=history");
    expect(html).toContain("Здесь появятся завершённые и отменённые поездки.");
  });
});

describe("TripPage driver", () => {
  it("поездка водителя с заявками: строки с −/+ вместо «Вы водитель»", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 2 })]),
    );
    // Один общий запрос заявок водителя (кэш shared с Главной),
    // фильтр по trip.id — внутри DriverTripRequests.
    mockUseDriverRequests.mockReturnValue(
      queryState({
        data: [
          {
            id: "req-1",
            seat: 1,
            status: "pending",
            comment: "еду с рюкзаком",
            trip: { id: "t-1" },
            passenger: { name: "Пётр", rating: 4.8 },
          },
          {
            id: "req-2",
            seat: 2,
            status: "pending",
            trip: { id: "t-1" },
            passenger: { name: "Анна" },
          },
          {
            id: "req-other",
            seat: 1,
            status: "pending",
            trip: { id: "t-2" },
            passenger: { name: "Чужой" },
          },
        ],
      }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Заявки: 2");
    expect(html).toContain("Пётр");
    expect(html).toContain("Анна");
    // Чужая поездка отфильтрована по trip.id.
    expect(html).not.toContain("Чужой");
    // Subline заявки: место; рейтинг — бейджем на аватаре.
    expect(html).toContain("место №1");
    expect(html).toContain("4.8");
    expect(html).not.toContain("еду с рюкзаком");
    expect(html).toContain("Отклонить заявку Пётр");
    expect(html).toContain("Принять заявку Пётр");
    expect(html).not.toContain("Вы водитель");
    expect(html).not.toContain("Ожидают решения");
    // Единый футер: Детали — поделиться — Отмена (без Управления/Завершить).
    expect(html).toContain("Детали поездки");
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Управление поездкой");
    expect(html).not.toContain("Завершить");
    expect(html).toContain("+ Создать поездку");
  });

  it("поездка водителя без заявок: «Вы водитель»", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 0 })]),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Вы водитель");
    expect(html).toContain("Свободно 2 из 3");
  });

  it("завершённая поездка — без destructive-кнопок", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ status: "completed" })]),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Завершена");
    expect(html).not.toContain("Завершить");
  });

  it("пусто — плейсхолдер (кнопка создания внутри ленты, её нет)", () => {
    mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Пока пусто");
    expect(html).toContain("Пока тихо");
  });
});

describe("TripPage driver requests states", () => {
  it("загрузка заявок — скелетон, бейдж счётчика на месте", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 2 })]),
    );
    mockUseDriverRequests.mockReturnValue(queryState({ isLoading: true }));
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Заявки: 2");
    expect(html).toContain('aria-label="Загрузка заявок"');
    expect(html).not.toContain("Пётр");
  });

  it("ошибка загрузки заявок — alert и «Повторить»", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 2 })]),
    );
    mockUseDriverRequests.mockReturnValue(
      queryState({ error: new Error("network down") }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain('role="alert"');
    expect(html).toContain("network down");
    expect(html).toContain("Повторить");
  });

  it("ошибка accept/decline — инлайн-alert", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 1 })]),
    );
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
    mockUseUpdateBookingStatus.mockReturnValue(
      mutation({ error: new Error("update failed") }),
    );
    const html = render(<TripPage />, "/bookings?segment=driver");
    expect(html).toContain("Пётр");
    expect(html).toContain('role="alert"');
    expect(html).toContain("update failed");
  });
});

describe("TripPage mutation errors", () => {
  it("ошибка отмены брони — alert с понятным текстом", () => {
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
    const html = render(<TripPage />);
    expect(html).toContain('role="alert"');
  });
});
