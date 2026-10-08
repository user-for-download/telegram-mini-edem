// Регресс: завершённая поездка с confirmed-бронью (scope history)
// не попадает в «Активные», хотя статус брони активный.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/Toast/ToastProvider";
import { ApiError } from "@/api/client";

const {
  mockUseMyBookings,
  mockUseInfiniteMyTrips,
  mockUseCancelTrip,
  mockUseDriverRequests,
  mockUseTripDemand,
} = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseTripDemand: vi.fn(),
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

// Спрос на поездку (`GET /trips/:id/requests`) — отдельный мок: без него
// висящий в карточке `useTripDemandQuery` звал бы настоящий useQuery без
// QueryClientProvider. Пустой ответ по умолчанию — карточка ничего не рисует.
// Мутация приглашения в этом моке нужна заглушкой: строки спроса рисуются в
// тестах ниже, а хук зовётся на каждой из них.
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useTripDemandQuery: mockUseTripDemand,
  useInviteRideRequestMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
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
  mockUseTripDemand.mockReturnValue(queryState({ data: [] }));
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

describe("TripActivePage: карточка спроса на свою поездку", () => {
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

  function rideRequest(id: string, seats: number) {
    return {
      id,
      fromCity: { id: "c-1", name: "Вологда" },
      toCity: { id: "c-2", name: "Сокол" },
      earliestAt: "2030-06-02T05:00:00.000Z",
      latestAt: "2030-06-02T12:00:00.000Z",
      seats,
      status: "active",
      expiresAt: "2030-06-01T05:00:00.000Z",
      createdAt: "2030-05-01T05:00:00.000Z",
      updatedAt: "2030-05-01T05:00:00.000Z",
    };
  }

  function driverPageWithDemand() {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [{ items: [demandTrip()] }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
  }

  it("N=3: заголовок из items.length и строки заявок", () => {
    // Arrange
    driverPageWithDemand();
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: [
          rideRequest("r-1", 1),
          rideRequest("r-2", 2),
          rideRequest("r-3", 1),
        ],
      }),
    );

    // Act
    const html = render(<TripActivePage />, "/bookings?segment=driver");

    // Assert
    expect(html).toContain("3 человека ищут попутку по твоему маршруту");
    expect(html).toContain("2 места");
    expect(html).toContain("1 место");
  });

  it("matchingEnabled=false: пояснение видно, карточка спроса не рисуется", () => {
    // Молчание карточки спроса неотличимо от «спроса нет», поэтому при
    // выключенном подборе водитель должен видеть, что это ЕГО выбор.
    driverPageWithDemand();
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [{ items: [demandTrip({ matchingEnabled: false })] }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    mockUseTripDemand.mockReturnValue(queryState({ data: [] }));

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).toContain("Подбор попутчиков выключен");
    // Пояснение обещает правду о поиске: поездку из поиска не прячут.
    expect(html).toContain("обычным поиском");
    // Это не список заявок: ни строк, ни действий-приглашений.
    expect(html).not.toContain("ищут попутку по твоему маршруту");
    expect(html).not.toContain("Пригласить");
  });

  it("matchingEnabled=true: пояснения нет", () => {
    driverPageWithDemand();
    mockUseTripDemand.mockReturnValue(queryState({ data: [] }));

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).not.toContain("Подбор попутчиков выключен");
  });

  it("matchingEnabled=undefined: пояснения нет — неизвестно ≠ выключено", () => {
    // MEMORY §18. На старом или замоканном ответе флага нет; угадывать его
    // как «выключено» значило бы врать водителю, что он что-то отключил.
    driverPageWithDemand();
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                (({ matchingEnabled: _omitted, ...rest }) => rest)(
                  demandTrip(),
                ),
              ],
            },
          ],
        },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    mockUseTripDemand.mockReturnValue(queryState({ data: [] }));

    const html = render(<TripActivePage />, "/bookings?segment=driver");

    expect(html).not.toContain("Подбор попутчиков выключен");
    expect(html).toContain("Сокол");
  });

  it("N=0: карточки нет вовсе, поездка на месте", () => {
    // Arrange
    driverPageWithDemand();
    mockUseTripDemand.mockReturnValue(queryState({ data: [] }));

    // Act
    const html = render(<TripActivePage />, "/bookings?segment=driver");

    // Assert
    expect(html).toContain("Сокол");
    expect(html).not.toContain("ищут попутку по твоему маршруту");
  });

  it("403 (не водитель) — тишина: экран цел, спроса нет", () => {
    // Arrange
    driverPageWithDemand();
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError("Forbidden", "FORBIDDEN", 403),
      }),
    );

    // Act
    const html = render(<TripActivePage />, "/bookings?segment=driver");

    // Assert
    expect(html).toContain("Сокол");
    expect(html).not.toContain("ищут попутку по твоему маршруту");
    expect(html).not.toContain("Forbidden");
  });

  it("бронь (сегмент пассажира) карточку спроса не рисует", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({ data: [rideRequest("r-1", 1)] }),
    );
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({
        data: { pages: [] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    );
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-now",
            seat: 1,
            status: "confirmed",
            scope: "active",
            trip: {
              id: "t-booked",
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

    // Act
    const html = render(<TripActivePage />, "/bookings?segment=passenger");

    // Assert
    expect(html).toContain("Череповец");
    expect(html).not.toContain("ищут попутку по твоему маршруту");
  });
});
