// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import type { Booking } from "@edem/contracts";
import { ToastProvider } from "@/components/Toast/ToastProvider";
import { TripPassengers } from "../TripPassengers";

const { tripQuery, driverQuery } = vi.hoisted(() => ({ tripQuery: vi.fn(), driverQuery: vi.fn() }));
vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: tripQuery,
  useDriverRequestsQuery: driverQuery,
  useUpdateBookingStatusMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function booking(index: number): Booking {
  return {
    id: `b-${index}`, status: "pending", seat: 1, trip: { id: "t-1" },
    passenger: { id: `u-${index}`, name: `Пассажир ${index}`, rating: 0, reviewsCount: 0 },
  } as unknown as Booking;
}
function query(items: Booking[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items }] }, isLoading: false, isError: false, error: null,
    hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false,
    fetchNextPage: vi.fn(), refetch: vi.fn(), ...overrides,
  };
}
function view() {
  return <AppRoot platform="base"><MemoryRouter><ToastProvider><TripPassengers tripId="t-1" pendingCount={51} /></ToastProvider></MemoryRouter></AppRoot>;
}

describe("TripPassengers: per-trip pagination and retry", () => {
  it("догружает 51-ю заявку и не зависит от ограниченной общей сводки", () => {
    const first = Array.from({ length: 50 }, (_, index) => booking(index));
    const state = query(first, { hasNextPage: true });
    tripQuery.mockReturnValue(state);
    driverQuery.mockReturnValue({ data: [], isLoading: false });
    const rendered = render(view());
    expect(driverQuery).toHaveBeenCalledWith({ enabled: false });
    expect(screen.getByRole("button", { name: "Открыть профиль: Пассажир 49" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Открыть профиль: Пассажир 50" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё пассажиров" }));
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);

    tripQuery.mockReturnValue(query([], { data: { pages: [{ items: first }, { items: [first[49], booking(50)] }] } }));
    rendered.rerender(view());
    expect(screen.getByRole("button", { name: "Открыть профиль: Пассажир 50" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Открыть профиль:/ })).toHaveLength(51);
  });

  it("при ошибке повторяет запрос этой поездки, не глобальную сводку", () => {
    const state = query([], { isError: true, error: new Error("Network failed") });
    tripQuery.mockReturnValue(state);
    driverQuery.mockReturnValue({ data: [], isLoading: false });
    render(view());
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить заявки");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку пассажиров" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("ошибка следующей страницы оставляет строки и повторяет догрузку", () => {
    const state = query([booking(0)], { hasNextPage: true, isError: true, isFetchNextPageError: true, error: new Error("Next page") });
    tripQuery.mockReturnValue(state);
    driverQuery.mockReturnValue({ data: [], isLoading: false });
    render(view());
    expect(screen.getByRole("button", { name: "Открыть профиль: Пассажир 0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(state.refetch).not.toHaveBeenCalled();
  });
});
