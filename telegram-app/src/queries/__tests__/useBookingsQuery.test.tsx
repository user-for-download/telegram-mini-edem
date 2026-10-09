// @vitest-environment jsdom
// Инвалидация после мутаций брони: бронь закрывает подходящие заявки
// пассажира на бэке (closeRideRequestsForBooking), поэтому «Мои заявки» на
// /profile/ride-requests обязаны обновиться тем же успехом. Без этого заявка
// оставалась «Активен» до staleTime 30с — то есть пассажир видел бы заявку,
// уже закрытую его же бронью.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { mockCreateBooking } = vi.hoisted(() => ({
  mockCreateBooking: vi.fn(),
}));

vi.mock("@/api/bookings.api", () => ({
  bookingsApi: {
    createBooking: mockCreateBooking,
    getUserBookings: vi.fn(),
    getHistory: vi.fn(),
    getDriverRequests: vi.fn(),
    getTripBookings: vi.fn(),
    updateBookingStatus: vi.fn(),
    cancelBooking: vi.fn(),
  },
}));

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { BOOKING_KEYS, useCreateBookingMutation } from "@/queries/useBookingsQuery";
import { RIDE_REQUEST_KEYS } from "@/queries/useRideRequestsQuery";
import { TRIP_KEYS } from "@/queries/useTripsQuery";

const CREATED = { id: "b-1", tripId: "t-1", seat: 1, status: "pending" };

function CreateBookingProbe() {
  const mutation = useCreateBookingMutation();
  return (
    <button
      type="button"
      onClick={() => mutation.mutate({ tripId: "t-1", seat: 1 })}
    >
      book
    </button>
  );
}

function countCalls(spy: ReturnType<typeof vi.spyOn>, key: readonly unknown[]) {
  const calls = spy.mock.calls as unknown as readonly [
    { queryKey?: readonly unknown[] },
  ][];
  return calls.filter(
    (call) =>
      JSON.stringify(call[0]?.queryKey) === JSON.stringify(key),
  ).length;
}

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderProbe() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const tree: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <CreateBookingProbe />
    </QueryClientProvider>
  );
  await act(async () => {
    root?.render(tree);
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("кнопка не отрендерена");
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  mockCreateBooking.mockResolvedValue(CREATED);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

describe("useCreateBookingMutation: успех обновляет и заявки, не только брони", () => {
  it("инвалидирует брони, поездки И заявки пассажира", async () => {
    // Arrange / Act
    await renderProbe();

    // Assert: заявки закрыты этой же бронью — список «Мои заявки» обязан
    // сменить статус, иначе он до 30 секунд показывает «Активен».
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(countCalls(invalidateSpy, BOOKING_KEYS.all)).toBe(1);
    expect(countCalls(invalidateSpy, TRIP_KEYS.all)).toBe(1);
    expect(countCalls(invalidateSpy, RIDE_REQUEST_KEYS.all)).toBe(1);
  });
});
