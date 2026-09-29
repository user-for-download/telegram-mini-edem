import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextTripBanner, pickNextTrip } from "@/components/Section/NextTripBanner";

const { mockUseMyBookings, mockUseInfiniteMyTrips } = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
}));

function queryState(overrides: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: false, ...overrides };
}

function pages(items: unknown[]) {
  return { pages: [{ items, pagination: {} }] };
}

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/"]}>{element}</MemoryRouter>
    </AppRoot>,
  );
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (t: number) => new Date(t).toISOString();

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    fromCity: "Вологда",
    toCity: "Череповец",
    departureAt: iso(NOW + DAY),
    price: 500,
    seatsAvailable: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseInfiniteMyTrips.mockReturnValue(queryState({ data: pages([]) }));
});

describe("pickNextTrip", () => {
  it("пусто — null", () => {
    expect(pickNextTrip([], [], NOW)).toBeNull();
  });

  it("ближайшая из брони и поездки водителя — бронь", () => {
    const booking = {
      status: "confirmed",
      scope: "active",
      seat: 2,
      trip: trip({ id: "tb", departureAt: iso(NOW + 2 * 60 * 60 * 1000) }),
    };
    const drive = trip({ id: "td", departureAt: iso(NOW + DAY) });
    expect(pickNextTrip([booking], [drive], NOW)).toMatchObject({
      tripId: "tb",
      role: "passenger",
      seat: 2,
    });
  });

  it("уехавшие и history отсекаются", () => {
    const past = {
      status: "confirmed",
      scope: "active",
      seat: 1,
      trip: trip({ id: "past", departureAt: iso(NOW - DAY) }),
    };
    const hist = {
      status: "confirmed",
      scope: "history",
      seat: 1,
      trip: trip({ id: "hist", departureAt: iso(NOW + DAY) }),
    };
    expect(pickNextTrip([past, hist], [], NOW)).toBeNull();
  });
});

describe("NextTripBanner", () => {
  it("без предстоящих — ничего", () => {
    expect(render(<NextTripBanner />)).not.toContain("next-trip-banner");
  });

  it("рисует ближайшую бронь с датой, ценой и местом", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b1",
            status: "confirmed",
            scope: "active",
            seat: 2,
            trip: trip(),
          },
        ],
      }),
    );
    const html = render(<NextTripBanner />);
    expect(html).toContain("next-trip-banner");
    expect(html).toContain("Вологда → Череповец");
    expect(html).toContain("500 ₽");
    expect(html).toContain("место 2");
    expect(html).toContain("Едете как пассажир");
  });

  it("поездка водителя — иконка водителя и свободные места", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      queryState({ data: pages([trip({ id: "td" })]) }),
    );
    const html = render(<NextTripBanner />);
    expect(html).toContain("Едете как водитель");
    expect(html).toContain("свободно 2");
  });
});
