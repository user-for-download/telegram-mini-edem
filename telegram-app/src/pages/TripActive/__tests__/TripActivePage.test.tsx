// Регресс: завершённая поездка с confirmed-бронью (scope history)
// не попадает в «Активные», хотя статус брони активный.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/Toast/ToastProvider";

const {
  mockUseMyBookings,
  mockUseInfiniteMyTrips,
  mockUseCancelTrip,
  mockUseDriverRequests,
} = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseCancelTrip: vi.fn(
    (): {
      mutate: ReturnType<typeof vi.fn>;
      isPending: boolean;
      variables: string | undefined;
    } => ({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    }),
  ),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 4.9 } }),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useCancelBookingMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useTripBookingsQuery: () => ({ data: { pages: [] } }),
  useUpdateBookingStatusMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { TripActivePage } from "@/pages/TripActive/TripActivePage";

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

function render(element: ReactNode, url = "/bookings"): string {
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
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
});

describe("TripActivePage scope", () => {
  it("confirmed-брони scope history (уехавшие/завершённые) скрыты", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-past",
            seat: 1,
            status: "confirmed",
            scope: "history",
            trip: {
              id: "t-past",
              fromCity: "Вологда",
              toCity: "Сокол",
              departureAt: "2026-09-15T03:00:00.000Z",
              price: 400,
              driver: { name: "Марина Ковалёва" },
            },
          },
          {
            id: "b-now",
            seat: 1,
            status: "confirmed",
            scope: "active",
            trip: {
              id: "t-now",
              fromCity: "Вологда",
              toCity: "Череповец",
              departureAt: "2030-06-01T09:00:00.000Z",
              price: 450,
              driver: { name: "Александр" },
            },
          },
        ],
      }),
    );
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    // Сегмент пассажира: активная бронь видна, scope history — нет.
    const html = render(<TripActivePage />, "/bookings?segment=passenger");
    expect(html).not.toContain("Сокол");
    expect(html).toContain("Череповец");
    // Бейджи без счётчиков.
    expect(html).toContain("Пассажир");
    expect(html).not.toContain("Пассажир (");
  });

  it("legacy ?segment=bookings открывается как Пассажир", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-now",
            seat: 1,
            status: "confirmed",
            scope: "active",
            trip: {
              id: "t-now",
              fromCity: "Вологда",
              toCity: "Череповец",
              departureAt: "2030-06-01T09:00:00.000Z",
              price: 450,
              driver: { name: "Александр" },
            },
          },
        ],
      }),
    );
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    const html = render(<TripActivePage />, "/bookings?segment=bookings");
    expect(html).toContain("Череповец");
  });

  it("Все: поездки и брони одним списком, бейдж Водитель — только с заявками", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-now",
            seat: 1,
            status: "confirmed",
            scope: "active",
            trip: {
              id: "t-now",
              fromCity: "Вологда",
              toCity: "Череповец",
              departureAt: "2030-06-01T09:00:00.000Z",
              price: 450,
              driver: { name: "Александр" },
            },
          },
        ],
      }),
    );
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                {
                  id: "t-drive",
                  status: "active",
                  fromCity: "Вологда",
                  toCity: "Сокол",
                  departureAt: "2030-06-02T09:00:00.000Z",
                  price: 400,
                  seatsAvailable: 2,
                  seatsTotal: 4,
                  pendingRequestsCount: 3,
                  confirmedBookingsCount: 0,
                },
              ],
            },
          ],
        },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    const html = render(<TripActivePage />);
    expect(html).toContain("Череповец");
    expect(html).toContain("Сокол");
    expect(html).toContain("Все");
    expect(html).toContain("Водитель");
    // Водитель: поездка с заявками видна.
    const driverHtml = render(<TripActivePage />, "/bookings?segment=driver");
    expect(driverHtml).toContain("Сокол");
    expect(driverHtml).not.toContain("Череповец");
  });

  it("Водитель без заявок: условие снято, видны все поездки", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    const plain = {
      id: "t-plain",
      status: "active",
      fromCity: "Вологда",
      toCity: "Грязовец",
      departureAt: "2030-06-02T09:00:00.000Z",
      price: 400,
      seatsAvailable: 2,
      seatsTotal: 4,
      pendingRequestsCount: 0,
      confirmedBookingsCount: 0,
    };
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [{ items: [plain] }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    const html = render(<TripActivePage />, "/bookings?segment=driver");
    expect(html).toContain("Грязовец");
  });
});

describe("TripActivePage per-card cancel pending (F5)", () => {
  function driverTrip(id: string, toCity: string, departureAt: string) {
    return {
      id,
      status: "active",
      fromCity: "Вологда",
      toCity,
      departureAt,
      price: 400,
      seatsAvailable: 2,
      seatsTotal: 4,
      pendingRequestsCount: 0,
      confirmedBookingsCount: 0,
    };
  }

  it("отмена поездки водителя pending только на отменяемой карточке", () => {
    // Arrange
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseCancelTrip.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      variables: "t-cancel",
    });
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                driverTrip("t-other", "Сокол", "2030-06-01T09:00:00.000Z"),
                driverTrip("t-cancel", "Череповец", "2030-06-02T09:00:00.000Z"),
              ],
            },
          ],
        },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );

    // Act
    const html = render(<TripActivePage />);

    // Assert
    expect(html).toContain("Сокол");
    expect(html).toContain("Череповец");
    // Обе карточки рендерят кнопку отмены, но disabled — ровно одна.
    expect(html.match(/Отменить поездку/g) ?? []).toHaveLength(2);
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(1);
  });
});

describe("TripActivePage: пин «подбор выключен»", () => {
  // Спроса (заявок попутчиков) на экране поездок больше нет — по решению
  // владельца 2026-10-09 он остался информацией на главной. Поэтому здесь
  // проверяется только то, что водитель всё ещё видит свой выбор: молчание
  // «никто не ищет» неотличимо от «спрос выключен», и без пояснения это
  // выглядит как отсутствие людей.
  function demandTrip(overrides: Record<string, unknown> = {}) {
    return {
      id: "t-demand",
      // Обязательны в tripSchema. Дефолты = включённый подбор, то есть
      // состояние, в котором пина быть не должно.
      autoComplete: false,
      matchingEnabled: true,
      status: "active",
      fromCity: "Вологда",
      toCity: "Сокол",
      departureAt: "2030-06-02T09:00:00.000Z",
      price: 400,
      seatsAvailable: 2,
      seatsTotal: 4,
      pendingRequestsCount: 0,
      confirmedBookingsCount: 0,
      ...overrides,
    };
  }

  function driverPage(trips: readonly unknown[]) {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [{ items: trips }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
  }

  it("matchingEnabled=false: пояснение видно", () => {
    driverPage([demandTrip({ matchingEnabled: false })]);

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).toContain("Подбор попутчиков выключен");
    // Пояснение обещает правду о поиске: поездку из поиска не прячут.
    expect(html).toContain("обычным поиском");
  });

  it("matchingEnabled=true: пояснения нет", () => {
    driverPage([demandTrip()]);

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).not.toContain("Подбор попутчиков выключен");
  });

  it("matchingEnabled=undefined: пояснения нет — неизвестно ≠ выключено", () => {
    // MEMORY §18. На старом или замоканном ответе флага нет; угадывать его
    // как «выключено» значило бы врать водителю, что он что-то отключил.
    driverPage([(({ matchingEnabled: _omitted, ...rest }) => rest)(demandTrip())]);

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).not.toContain("Подбор попутчиков выключен");
    expect(html).toContain("Сокол");
  });
});
