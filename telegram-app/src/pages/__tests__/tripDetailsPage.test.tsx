// Рендер-тесты TripDetailsPage без @testing-library/react (не установлен):
// react-dom/server renderToString + MemoryRouter + моки query-хуков —
// паттерн telegram-app/src/pages/__tests__/reviewsPage.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseTripDetail,
  mockUseTripBookings,
  mockUseCreateBooking,
  mockUseCancelBooking,
  mockUseCancelTrip,
  mockUseCompleteTrip,
  authState,
} = vi.hoisted(() => ({
  mockUseTripDetail: vi.fn(),
  mockUseTripBookings: vi.fn(),
  mockUseCreateBooking: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  authState: { userId: "u-pass" },
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useTripDetailQuery: mockUseTripDetail,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: mockUseCompleteTrip,
    // Фоновая SearchPage за шторкой: пустая лента без загрузки.
    useInfiniteTripsQuery: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    }),
  };
});

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useCreateBookingMutation: mockUseCreateBooking,
  useCancelBookingMutation: mockUseCancelBooking,
}));

vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user: { id: authState.userId, name: "Пользователь" } }),
    { setState: () => {}, getState: () => ({ user: { id: authState.userId } }) },
  ),
}));

import { TripDetailsPage } from "@/pages/TripDetailsPage";
import { ToastProvider } from "@/components/ToastProvider";
import { ApiError } from "@/api/client";

const DRIVER = {
  id: "u-driver",
  name: "Иван Водителев",
  rating: 4.9,
  reviewsCount: 7,
  car: { model: "Lada Vesta" },
};

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    fromAddress: "м. Тёплый Стан",
    toAddress: "пр-т Ленина",
    date: "1 июня 2030",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 150,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: DRIVER,
    tags: ["Не курить"],
    comment: "Еду без остановок",
    status: "active",
    bookedSeats: [2],
    myBooking: null,
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function setMocks(
  trip: Record<string, unknown> | null,
  overrides: {
    detail?: Record<string, unknown>;
    bookings?: Record<string, unknown>;
    create?: Record<string, unknown>;
    cancelBooking?: Record<string, unknown>;
    cancelTrip?: Record<string, unknown>;
    completeTrip?: Record<string, unknown>;
  } = {},
) {
  mockUseTripDetail.mockReturnValue({
    data: trip,
    isLoading: false,
    isError: !trip,
    error: trip ? null : new Error("Not found"),
    refetch: vi.fn(),
    ...overrides.detail,
  });
  mockUseTripBookings.mockReturnValue({
    data: { pages: [{ items: [], pagination: {} }] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...overrides.bookings,
  });
  mockUseCreateBooking.mockReturnValue(mutation(overrides.create));
  mockUseCancelBooking.mockReturnValue(mutation(overrides.cancelBooking));
  mockUseCancelTrip.mockReturnValue(mutation(overrides.cancelTrip));
  mockUseCompleteTrip.mockReturnValue(mutation(overrides.completeTrip));
}

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <AppRoot platform="base">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/trips/t-1"]}>
          <ToastProvider>
            <Routes>
              <Route path="/trips/:tripId" element={<TripDetailsPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

describe("TripDetailsPage parity", () => {
  it("shows full details, seat choice and comment instead of hard-coded seat", () => {
    setMocks(makeTrip());
    const html = render();
    expect(html).toContain("м. Тёплый Стан");
    expect(html).toContain("2 ч 30 мин");
    // SSR разбивает комментариями: «180<!-- --> км».
    expect(html).toContain("180");
    expect(html).toContain("км");
    expect(html).toContain("Не курить");
    expect(html).toContain("Еду без остановок");
    expect(html).toContain("Комментарий водителю");
    expect(html).toContain("Забронировать место");
    // Занятое место помечено, свободные — выбираемые кнопки.
    // SSR разбивает текст комментарием: «2<!-- --> (зан.)».
    expect(html).toContain("(зан.)");
    expect(html).not.toContain("seat:1");
  });

  it("masks meeting addresses for strangers", () => {
    setMocks(makeTrip({ fromAddress: undefined, toAddress: undefined }));
    expect(render()).toContain("после подтверждения брони");
  });

  it("blocks booking of departed trips with an explicit state", () => {
    setMocks(
      makeTrip({ departureAt: new Date(Date.now() - 3_600_000).toISOString() }),
    );
    const html = render();
    expect(html).toContain("уже отправилась");
    expect(html).not.toContain("Комментарий водителю");
  });

  it("shows the booking status and guarded cancel for own booking", () => {
    setMocks(
      makeTrip({
        myBooking: { id: "b-1", seat: 1, status: "pending" },
        bookedSeats: [1, 2],
        seatsAvailable: 1,
      }),
    );
    const html = render();
    expect(html).toContain("Вы записались попутчиком");
    expect(html).toContain("Отменить бронирование");
  });

  it("shows share action", () => {
    setMocks(makeTrip());
    expect(render()).toContain("Поделиться поездкой");
  });

  it("offers retry on load error", () => {
    setMocks(null);
    const html = render();
    expect(html).toContain("Поездка не найдена");
    expect(html).toContain("Повторить");
    expect(html).toContain("К поиску");
  });

  it("shows owner controls with guarded destructive actions", () => {
    authState.userId = "u-driver";
    try {
      setMocks(makeTrip());
      const html = render();
      expect(html).toContain("Управление поездкой");
      expect(html).toContain("Редактировать поездку");
      expect(html).toContain("Завершить поездку");
      expect(html).toContain("Отменить поездку");
      expect(html).not.toContain("Комментарий водителю");
    } finally {
      authState.userId = "u-pass";
    }
  });

  it("maps booking conflicts to actionable text", () => {
    setMocks(makeTrip(), {
      create: { error: new ApiError("taken", "SEAT_TAKEN", 409) },
    });
    // Сообщение появится только в ветке бронирования (canBook=true) — ок.
    expect(render()).toContain("только что заняли");
  });
});
