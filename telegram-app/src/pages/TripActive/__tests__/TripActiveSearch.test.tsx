// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { TripCardVariant } from "@/components/Trip/TripCard";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { ownTrips, bookings, sentinel } = vi.hoisted(() => ({
  ownTrips: vi.fn(), bookings: vi.fn(), sentinel: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: ownTrips,
  useCancelTripMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: bookings,
  useCancelBookingMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useInfiniteSentinel", () => ({ useInfiniteSentinel: sentinel }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/components/Trip/TripCard", () => ({
  TripCard: ({ variant }: { variant: TripCardVariant }) => {
    const trip = variant.kind === "driving" ? variant.trip : variant.booking.trip;
    return <article data-trip={trip.id}>{trip.fromCity} → {trip.toCity}</article>;
  },
}));

import { TripActivePage } from "../TripActivePage";

let container: HTMLDivElement;
let root: Root;

function trip(id: string, toCity: string, departureAt = "2030-01-01T00:00:00Z") {
  return { id, fromCity: "Москва", toCity, departureAt, pendingRequestsCount: 0 };
}

function infinite(items: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items }] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

async function render(segment = "all") {
  await act(async () => root.render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[`/bookings?segment=${segment}`]}>
        <TripActivePage />
      </MemoryRouter>
    </AppRoot>,
  ));
}

async function search(value: string) {
  const input = container.querySelector("input");
  if (!input) throw new Error("search input missing");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function debounce() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ownTrips.mockReturnValue(infinite());
  bookings.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  sentinel.mockReturnValue({ current: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("TripActive full server search", () => {
  it("debounces normalized server q, does not filter an unsearched first page or show final empty", async () => {
    ownTrips.mockImplementation(({ q }: { q: string }) => q === "казань"
      ? infinite([trip("beyond-page-1", "Казань")])
      : infinite([trip("first-page", "Тула")], { hasNextPage: true }),
    );
    await render("driver");
    expect(container.querySelector("input")?.maxLength).toBe(100);
    await search("  КАЗАНЬ  ");
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(ownTrips.mock.calls.at(-1)?.[0]).toEqual({ status: "active", q: "" });
    expect(container.textContent).not.toContain("Поездок не найдено");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(sentinel.mock.calls.at(-1)?.[0].disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(ownTrips.mock.calls.at(-1)?.[0]).toEqual({ status: "active", q: "казань" });
    expect(container.querySelector("article")?.dataset.trip).toBe("beyond-page-1");
    expect(container.textContent).not.toContain("Тула");
  });

  it.each(["all", "driver"])("%s: an empty loaded page with hasMore retains FetchMore and next-page retry", async (segment) => {
    const fetchNextPage = vi.fn();
    ownTrips.mockReturnValue(infinite([], {
      hasNextPage: true, isFetchNextPageError: true, error: new Error("next page failed"), fetchNextPage,
    }));
    await render(segment);
    expect(container.textContent).not.toContain("Пока тихо");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Не удалось загрузить ещё");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Повторить загрузку");
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(fetchNextPage).toHaveBeenCalledOnce();
    expect(sentinel.mock.calls.at(-1)?.[0].disabled).toBe(true);
  });

  it("keeps loaded cards and dogruzka loading feedback instead of replacing the list", async () => {
    ownTrips.mockReturnValue(infinite([trip("already-loaded", "Тула")], {
      hasNextPage: true, isFetchingNextPage: true,
    }));
    await render("driver");
    expect(container.querySelector("article")?.dataset.trip).toBe("already-loaded");
    expect(container.querySelector('[role="status"][aria-label="Загрузка ещё поездок"]')).not.toBeNull();
    const more = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Показать ещё"));
    expect(more?.disabled).toBe(true);
  });

  it("shows initial loading/error and retry, then a final searched empty and reset", async () => {
    const refetch = vi.fn();
    ownTrips.mockImplementation(({ q }: { q: string }) => q
      ? infinite()
      : infinite([], { data: undefined, isLoading: true, refetch }),
    );
    await render("driver");
    expect(container.textContent).not.toContain("Пока тихо");
    expect(container.textContent).not.toContain("История поездок");
    ownTrips.mockReturnValue(infinite([], { data: undefined, error: new Error("offline"), refetch }));
    await render("driver");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Повторить");
    await act(async () => retry?.click());
    expect(refetch).toHaveBeenCalledOnce();
    ownTrips.mockReturnValue(infinite());
    await search("Unknown city");
    await debounce();
    const reset = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Сбросить поиск");
    expect(reset).toBeDefined();
    expect(container.textContent).not.toContain("Показать ещё");
    await act(async () => reset?.click());
    await debounce();
    expect(ownTrips.mock.calls.at(-1)?.[0].q).toBe("");
    expect(container.textContent).toContain("История поездок");
  });

  it.each(["all", "passenger"])("%s: passenger bookings still match city query locally, including literal %%_", async (segment) => {
    bookings.mockReturnValue({
      data: [
        { id: "booking-match", scope: "active", status: "confirmed", trip: trip("literal", "Город %_") },
        { id: "booking-other", scope: "active", status: "pending", trip: trip("unrelated", "Тула") },
        { id: "booking-history", scope: "history", status: "confirmed", trip: trip("history", "Архив %_") },
      ], isLoading: false, error: null, refetch: vi.fn(),
    });
    await render(segment);
    await search(" %_ ");
    await debounce();
    expect(Array.from(container.querySelectorAll("article")).map((card) => card.dataset.trip)).toEqual(["literal"]);
    expect(bookings.mock.calls.at(-1)).toEqual([]);
  });

  it("driver includes trips with and without requests in server page order; later pages append", async () => {
    const first = trip("first", "Тула");
    const second = { ...trip("second", "Казань", "2030-01-02T00:00:00Z"), pendingRequestsCount: 1 };
    ownTrips.mockReturnValue(infinite([first, second], { hasNextPage: true }));
    await render("driver");
    expect(Array.from(container.querySelectorAll("article")).map((card) => card.dataset.trip)).toEqual(["first", "second"]);
    ownTrips.mockReturnValue(infinite([], {
      data: { pages: [{ items: [first, second] }, { items: [trip("third", "Пермь", "2030-01-03T00:00:00Z")] }] },
    }));
    await render("driver");
    expect(Array.from(container.querySelectorAll("article")).map((card) => card.dataset.trip)).toEqual(["first", "second", "third"]);
  });
});
