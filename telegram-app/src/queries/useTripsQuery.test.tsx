// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * F2: отмена поездки инвалидирует и поездки, и брони — симметрично
 * завершению. Без @testing-library/react (не установлен): react-dom/client
 * + act из React 19, tripsApi — мок.
 */

const { mockCancelTrip, mockCompleteTrip } = vi.hoisted(() => ({
  mockCancelTrip: vi.fn(),
  mockCompleteTrip: vi.fn(),
}));

vi.mock("@/api/trips.api", () => ({
  tripsApi: {
    cancelTrip: mockCancelTrip,
    completeTrip: mockCompleteTrip,
  },
}));

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TRIP_KEYS,
  useCancelTripMutation,
  useCompleteTripMutation,
} from "./useTripsQuery";

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

function CancelProbe({ tripId }: { tripId: string }) {
  const { mutate } = useCancelTripMutation();
  useEffect(() => {
    mutate(tripId);
  }, [mutate, tripId]);
  return null;
}

function CompleteProbe({ tripId }: { tripId: string }) {
  const { mutate } = useCompleteTripMutation();
  useEffect(() => {
    mutate(tripId);
  }, [mutate, tripId]);
  return null;
}

function invalidateCallsFor(key: readonly unknown[]): number {
  return invalidateSpy.mock.calls.filter(
    (call: unknown[]) =>
      JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
      JSON.stringify(key),
  ).length;
}

async function renderProbe(node: ReactNode): Promise<void> {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
    );
  });
  // Мутация резолвится цепочкой микрозадач — дренируем их внутри act,
  // чтобы onSuccess с инвалидацией успел отработать до ассёртов.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useCancelTripMutation / useCompleteTripMutation (F2)", () => {
  beforeEach(() => {
    mockCancelTrip.mockReset();
    mockCompleteTrip.mockReset();
    mockCancelTrip.mockResolvedValue({ id: "trip-1" });
    mockCompleteTrip.mockResolvedValue({ id: "trip-1" });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
  });

  it("отмена инвалидирует и поездки, и брони (нет stale после отмены)", async () => {
    // Arrange + Act
    await renderProbe(<CancelProbe tripId="trip-1" />);

    // Assert
    expect(mockCancelTrip).toHaveBeenCalledWith("trip-1");
    expect(invalidateCallsFor([...TRIP_KEYS.all])).toBe(1);
    expect(invalidateCallsFor(["bookings"])).toBe(1);
  });

  it("завершение инвалидирует и поездки, и брони (симметрия с отменой)", async () => {
    // Arrange + Act
    await renderProbe(<CompleteProbe tripId="trip-1" />);

    // Assert
    expect(mockCompleteTrip).toHaveBeenCalledWith("trip-1");
    expect(invalidateCallsFor([...TRIP_KEYS.all])).toBe(1);
    expect(invalidateCallsFor(["bookings"])).toBe(1);
  });
});
