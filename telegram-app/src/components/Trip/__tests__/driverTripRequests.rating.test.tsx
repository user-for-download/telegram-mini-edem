// SSR-тесты бейджа рейтинга пассажира в DriverTripRequests: без отзывов —
// прочерк «—», а не мнимое 5.0 нового аккаунта (контракт отдаёт rating
// обязательным числом, app.md §5 — formatRating). Паттерн
// tripRequestsModal.test.tsx (SSR, моки хуков через vi.hoisted).
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseDriverRequests, mockUseUpdateBooking } = vi.hoisted(() => ({
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBooking: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBooking,
}));

import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { ToastProvider } from "@/components/Toast/ToastProvider";

function makeBooking(passenger: Record<string, unknown>) {
  return {
    id: "b-1",
    status: "pending",
    seat: 1,
    trip: { id: "t-1" },
    passenger: {
      id: "u-pass",
      name: "Анна Пассажирова",
      ...passenger,
    },
  };
}

function setMocks(bookings: Array<Record<string, unknown>>) {
  mockUseDriverRequests.mockReturnValue({
    data: bookings,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseUpdateBooking.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
}

function renderBody(): string {
  return renderToString(
    <AppRoot platform="base">
      <ToastProvider>
        <DriverTripRequests tripId="t-1" />
      </ToastProvider>
    </AppRoot>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("DriverTripRequests: бейдж рейтинга пассажира", () => {
  it("новый пассажир (5.0 при нуле отзывов) — прочерк, а не 5.0", () => {
    setMocks([makeBooking({ rating: 5, reviewsCount: 0 })]);
    const html = renderBody();
    expect(html).toContain("Анна Пассажирова");
    expect(html).toContain("—");
    expect(html).not.toContain("5.0");
  });

  it("пассажир с отзывами — число с точкой", () => {
    setMocks([makeBooking({ rating: 4.8, reviewsCount: 3 })]);
    const html = renderBody();
    expect(html).toContain("4.8");
    expect(html).not.toContain("—");
  });
});
