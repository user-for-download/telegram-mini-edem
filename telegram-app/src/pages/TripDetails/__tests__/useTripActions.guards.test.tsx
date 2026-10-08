// @vitest-environment jsdom
// Дефолты useTripActions без данных: неизвестное — не водитель и не актив.
// Регресс на `driver?.id === user?.id`: без поездки и без юзера оба id —
// undefined, и голое сравнение давало isDriver === true. Аналогично
// `!item?.status` давал isActive === true без поездки. Оба флага маскируются
// ранними return TripDetailsPage, но хук обязан врать и прямому потребителю.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    notificationOccurred: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    selectionChanged: { ifAvailable: vi.fn() },
  },
  miniApp: { ready: { ifAvailable: vi.fn() } },
  shareURL: { isAvailable: () => false, ifAvailable: vi.fn() },
}));

import { ToastProvider } from "@/components/Toast/ToastProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { useTripActions } from "@/pages/TripDetails/useTripActions";
import type { Trip } from "@edem/contracts";

const DRIVER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "33333333-3333-3333-3333-333333333333";

function makeTrip(driverId: string): Trip {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    driver: { id: driverId, name: "Водитель" },
    fromCity: "Вологда",
    toCity: "Череповец",
    departureAt: new Date(Date.now() + 60_000).toISOString(),
    status: "active",
    seatsTotal: 3,
    seatsAvailable: 2,
    price: 500,
    durationMinutes: 120,
    time: "10:00",
    bookedSeats: [],
  } as unknown as Trip;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function setUser(id: string | null) {
  useAuthStore.setState({
    user: id === null ? null : ({ id }) as never,
    session: null,
    status: id === null ? "unauthenticated" : "authenticated",
  });
}

beforeEach(() => {
  setUser(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTripActions: дефолты без данных", () => {
  it("нет поездки и нет юзера — не водитель, не активна, действий нет", () => {
    const { result } = renderHook(() => useTripActions(undefined), {
      wrapper,
    });

    expect(result.current.isDriver).toBe(false);
    expect(result.current.isActive).toBe(false);
    expect(result.current.canBook).toBe(false);
    expect(result.current.canCompleteTrip).toBe(false);
    expect(result.current.departed).toBe(false);
  });

  it("нет поездки, но юзер есть — всё равно не водитель", () => {
    setUser(OTHER_ID);
    const { result } = renderHook(() => useTripActions(undefined), {
      wrapper,
    });

    expect(result.current.isDriver).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  it("поездка есть, юзера нет — водитель не угадывается", () => {
    const { result } = renderHook(() => useTripActions(makeTrip(DRIVER_ID)), {
      wrapper,
    });

    expect(result.current.isDriver).toBe(false);
    expect(result.current.isActive).toBe(true);
  });

  it("поездка есть, юзер — водитель — флаг держится", () => {
    setUser(DRIVER_ID);
    const { result } = renderHook(() => useTripActions(makeTrip(DRIVER_ID)), {
      wrapper,
    });

    expect(result.current.isDriver).toBe(true);
    expect(result.current.canBook).toBe(false);
  });

  it("поездка есть, юзер — чужой — пассажир, не водитель", () => {
    setUser(OTHER_ID);
    const { result } = renderHook(() => useTripActions(makeTrip(DRIVER_ID)), {
      wrapper,
    });

    expect(result.current.isDriver).toBe(false);
  });
});
