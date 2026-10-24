// Панель водителя в деталях поездки: заявки и подтверждённые пассажиры
// показываются ПРЯМО ЗДЕСЬ, а не второй шторкой.
//
// Было: кнопка «Заявки пассажиров (N)» вела на route-backed модалку
// (/trips/my/:id/requests) поверх деталей — две модалки друг на друге,
// два закрытия подряд, accept/decline в третьем месте. Стало: те же Cell'ы
// из карточки поездки (DriverTripRequests) + список подтверждённых.
//
// Счётчик остался СЕРВЕРНЫЙ (pendingRequestsCount): строки приходят
// постранично по 50, и при 73 заявках подпись «Ожидают решения (73)» должна
// показывать 73, а не 50.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseTripBookings,
  mockUseDriverRequests,
  mockUseCancelTrip,
  mockUseCompleteTrip,
} = vi.hoisted(() => ({
  mockUseTripBookings: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  }),
  useCancelBookingMutation: vi.fn(),
  useMyBookingsQuery: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useCancelTripMutation: mockUseCancelTrip,
  useCompleteTripMutation: mockUseCompleteTrip,
}));

import { DriverPanel } from "@/pages/TripDetails/DriverPanel";
import { TripPassengers } from "@/components/Trip/TripPassengers";
import { ToastProvider } from "@/components/Toast/ToastProvider";

function mutationState() {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  };
}

/** Ответ /bookings/trip/:id: страницы по 50 строк. */
function tripBookings(pages: Array<{ items: Array<Record<string, unknown>> }>) {
  return {
    data: { pages, pageParams: pages.map(() => undefined) },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  };
}

/** Заявка водителя из общего запроса (кэш Главной). */
function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    status: "pending",
    seat: 1,
    trip: { id: "t-1" },
    passenger: {
      id: "u-pass",
      name: "Анна Пассажирова",
      avatar: "https://t.me/a.png",
      rating: 4.8,
      reviewsCount: 3,
    },
    ...overrides,
  };
}

function driverRequests(rows: Array<Record<string, unknown>>) {
  return {
    data: rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function confirmedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-c",
    status: "confirmed",
    seat: 2,
    passenger: {
      id: "u-conf",
      name: "Пётр Попутчиков",
      avatar: "https://t.me/c.png",
      rating: 5,
      reviewsCount: 1,
    },
    ...overrides,
  };
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
    seatsAvailable: 1,
    driver: { id: "u-me", name: "Я", rating: 5, reviewsCount: 1, avatar: null },
    tags: [],
    comment: null,
    status: "active",
    ...overrides,
  };
}

function renderPanel(
  trip: Record<string, unknown>,
  bookings: ReturnType<typeof tripBookings> | Record<string, unknown>,
  options: {
    requests?: ReturnType<typeof driverRequests>;
    departed?: boolean;
  } = {},
): string {
  mockUseTripBookings.mockReturnValue(bookings);
  mockUseDriverRequests.mockReturnValue(options.requests ?? driverRequests([]));
  mockUseCancelTrip.mockReturnValue(mutationState());
  mockUseCompleteTrip.mockReturnValue(mutationState());
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/trips/t-1"]}>
        <ToastProvider>
          {/* Заявки живут в композиции страницы (TripDetailsPage →
              TripHero.afterRoute), поэтому проверяем их вместе с
              управлением — так же, как они видны водителю. */}
          <TripPassengers
            tripId="t-1"
            pendingCount={(trip.pendingRequestsCount as number) ?? 0}
          />
          <DriverPanel
            tripId="t-1"
            status="active"
            isActive
            canCompleteTrip={options.departed ?? false}
            departed={options.departed ?? false}
            editing={false}
            onToggleEdit={vi.fn()}
            trip={trip as never}
          />
        </ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("DriverPanel: заявки прямо в деталях, без второй шторки", () => {
  it("строка заявки — на месте, кнопки-перехода больше нет", () => {
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 1 }),
      tripBookings([{ items: [] }]),
      { requests: driverRequests([requestRow()]) },
    );

    // Та же Cell'а, что в карточке поездки: имя, место, комментарий.
    expect(html).toContain("Анна Пассажирова");
    expect(html).toContain("место №1");
    // Группа подписана числом с сервера.
    expect(html).toContain("Ожидают решения");
    expect(html).toContain("(1)");
    // Второй модалки в дереве нет — кнопка-переход удалена.
    expect(html).not.toContain("Заявки пассажиров");
  });

  it("счётчик группы — серверный pendingRequestsCount, а не загруженные строки", () => {
    // 50 строк на странице, реальных заявок 73.
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 73 }),
      tripBookings([{ items: [] }]),
      { requests: driverRequests([requestRow()]) },
    );

    expect(html).toContain("(73)");
    expect(html).not.toContain("(50)");
  });

  it("подтверждённые пассажиры — списком «В поездке», только чтение", () => {
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 0 }),
      tripBookings([{ items: [confirmedRow()] }]),
    );

    expect(html).toContain("В поездке");
    expect(html).toContain("Пётр Попутчиков");
    expect(html).toContain("место №2");
    // Действий по подтверждённой брони в панели нет.
    expect(html).not.toContain("Отклонить заявку Пётр");
  });

  it("нет заявок — честное пустое состояние вместо пустого блока", () => {
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 0 }),
      tripBookings([{ items: [] }]),
    );
    expect(html).toContain("Заявок пока нет");
  });

  it("пока данные не пришли, «Заявок пока нет» не выдумывается", () => {
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 12 }),
      {
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
      },
    );

    expect(html).not.toContain("Заявок пока нет");
    // Число из trip видно сразу — оно не зависит от первой страницы.
    expect(html).toContain("(12)");
  });
});

describe("DriverPanel: уехавшую поездку отменить нельзя", () => {
  // Регресс: `/trips/:id/cancel` проверял только status === "active", а
  // автоархив наступает лишь через 24ч после отправления. В это окно водитель
  // видел живую «Отменить поездку» для рейса, который уже в пути, и
  // отмена сносила confirmed-брони пассажиров ПОСЛЕ поездки.
  const emptyBookings = tripBookings([{ items: [] }]);

  it("скрывает отмену после отправления", () => {
    const html = renderPanel({}, emptyBookings, { departed: true });
    expect(html).not.toContain("Отменить поездку");
    expect(html).toContain("Отмена недоступна после отправления");
  });

  it("оставляет завершение доступным после отправления", () => {
    const html = renderPanel({}, emptyBookings, { departed: true });
    expect(html).toContain("Завершить поездку");
    expect(html).not.toContain("Завершение станет доступно");
  });

  it("показывает отмену, пока поездка ещё не уехала", () => {
    const html = renderPanel({}, emptyBookings, { departed: false });
    expect(html).toContain("Отменить поездку");
    expect(html).toContain("Завершить поездку");
  });
});
