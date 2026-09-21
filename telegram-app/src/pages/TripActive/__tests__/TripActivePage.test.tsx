// Регресс: завершённая поездка с confirmed-бронью (scope history)
// не попадает в «Активные», хотя статус брони активный.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/ToastProvider";

const { mockUseMyBookings, mockUseInfiniteMyTrips } = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
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
    useCancelTripMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
