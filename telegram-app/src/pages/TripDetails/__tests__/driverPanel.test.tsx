// Число в кнопке «Заявки пассажиров (N)» на панели водителя.
//
// Регрессия: счётчик считал загруженные страницы /bookings/trip/:id, а
// бэкенд отдаёт по 50 строк на страницу. Пагинация с экрана не
// подгружается (кнопка ведёт на /trips/my/:id/requests), поэтому при
// >50 заявках водитель видел «50» вместо реального числа. Точный
// источник — серверный pendingRequestsCount, который уже приезжает в
// trip (детали поездки загружены), нового запроса не требуется.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseTripBookings,
  mockUseCancelTrip,
  mockUseCompleteTrip,
} = vi.hoisted(() => ({
  mockUseTripBookings: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useCancelBookingMutation: vi.fn(),
  useUpdateBookingStatusMutation: vi.fn(),
  useMyBookingsQuery: vi.fn(),
  useDriverRequestsQuery: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useCancelTripMutation: mockUseCancelTrip,
  useCompleteTripMutation: mockUseCompleteTrip,
}));

import { DriverPanel } from "@/pages/TripDetails/DriverPanel";

function mutationState() {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  };
}

/** Ответ /bookings/trip/:id: страницы по 50 строк. */
function tripBookings(pages: Array<{ items: Array<{ status: string }> }>) {
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
  bookings: ReturnType<typeof tripBookings>,
): string {
  mockUseTripBookings.mockReturnValue(bookings);
  mockUseCancelTrip.mockReturnValue(mutationState());
  mockUseCompleteTrip.mockReturnValue(mutationState());
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/trips/t-1"]}>
        <DriverPanel
          tripId="t-1"
          status="active"
          isActive
          canCompleteTrip={false}
          editing={false}
          onToggleEdit={vi.fn()}
          trip={trip as never}
        />
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("DriverPanel: счётчик заявок точный за пределами страницы", () => {
  it("happy: число из pendingRequestsCount, а не из загруженных строк", () => {
    // Первая страница забита полностью — 50 строк, реальных заявок 73.
    const full = Array.from({ length: 50 }, () => ({
      id: "b",
      status: "pending",
    }));
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 73 }),
      tripBookings([{ items: full }]),
    );

    // SSR разделяет соседние текстовые узлы маркером <!-- -->, поэтому
    // сравниваем части, а не склейку.
    expect(html).toContain("Заявки пассажиров");
    expect(html).toContain("(73)");
    expect(html).not.toContain("(50)");
  });

  it("edge: без pendingRequestsCount — подсчёт по загруженным страницам", () => {
    // Контракт делает поле опциональным: при его отсутствии не показываем
    // ноль, а откатываемся на прежнее поведение.
    const html = renderPanel(
      makeTrip(),
      tripBookings([
        { items: [{ status: "pending" }, { status: "confirmed" }] },
        { items: [{ status: "pending" }] },
      ]),
    );

    expect(html).toContain("Заявки пассажиров");
    expect(html).toContain("(2)");
  });

  it("edge: счётчик pending равным нулю совпадает с посчитанным", () => {
    const html = renderPanel(
      makeTrip({ pendingRequestsCount: 0 }),
      tripBookings([{ items: [] }]),
    );

    expect(html).toContain("Заявки пассажиров");
    expect(html).toContain("(0)");
  });

  it("edge: пока данные не пришли, число не выдумывается", () => {
    mockUseTripBookings.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
    mockUseCancelTrip.mockReturnValue(mutationState());
    mockUseCompleteTrip.mockReturnValue(mutationState());

    const html = renderToString(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/trips/t-1"]}>
          <DriverPanel
            tripId="t-1"
            status="active"
            isActive
            canCompleteTrip={false}
            editing={false}
            onToggleEdit={vi.fn()}
            trip={makeTrip({ pendingRequestsCount: 12 }) as never}
          />
        </MemoryRouter>
      </AppRoot>,
    );

    // Пока данные не пришли, число не выдумывается — как и раньше.
    expect(html).toContain("Заявки пассажиров");
    expect(html).not.toContain("(12)");
    expect(html).not.toContain("Повторить");
  });
});
