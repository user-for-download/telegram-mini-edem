// Регресс: завершённая поездка с confirmed-бронью (scope history)
// не попадает в «Активные», хотя статус брони активный.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/Toast/ToastProvider";

const { mockUseMyBookings, mockUseInfiniteMyTrips, mockUseCancelTrip } =
  vi.hoisted(() => ({
    mockUseMyBookings: vi.fn(),
    mockUseInfiniteMyTrips: vi.fn(),
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

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings"]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

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
    const html = render(<TripActivePage />);
    expect(html).not.toContain("Сокол");
    expect(html).toContain("Череповец");
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
