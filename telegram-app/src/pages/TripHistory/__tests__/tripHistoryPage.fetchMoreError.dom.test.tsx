// @vitest-environment jsdom
// Регресс F14: упавшая страница N+1 обязана быть видна как сбой с повтором,
// а не как обычное «есть ещё».
//
// Дефект был не в `ui/FetchMore`, а в вызовах: `FetchMore` рисует `role="alert"`
// и кнопку «Повторить загрузку» ТОЛЬКО когда передан `error`
// (`ui/FetchMore.tsx:69-80`). Три страницы — TripActive (оба сегмента ленты) и
// TripHistory — `error` не передавали, поэтому после сбоя страницы N+1
// `hasNextPage` остаётся истинным, а на экране та же самая кнопка
// «Показать ещё»: «страницы есть» и «страница не загрузилась» выглядят
// одинаково, а страницы цепляются автодогрузкой — без объявления о сбое её
// заметят, только проскроллив вниз.
//
// Файл закрывает F14 для двух страниц архива поездок; обзор отзывов —
// `reviewsPage.fetchMoreError.dom.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/Toast/ToastProvider";

const { mockPassengerHistory, mockMyBookings, mockDriverRequests, mockTrips } =
  vi.hoisted(() => ({
    mockPassengerHistory: vi.fn(),
    mockMyBookings: vi.fn(),
    mockDriverRequests: vi.fn(),
    mockTrips: vi.fn(),
  }));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 4.9 } }),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  usePassengerHistoryQuery: mockPassengerHistory,
  useMyBookingsQuery: mockMyBookings,
  useDriverRequestsQuery: mockDriverRequests,
  useCancelBookingMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useTripBookingsQuery: () => ({ data: { pages: [] } }),
  useUpdateBookingStatusMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteMyTripsQuery: mockTrips,
    useCancelTripMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    }),
    useCompleteTripMutation: () => ({ mutate: vi.fn() }),
  };
});

import { TripHistoryPage } from "@/pages/TripHistory/TripHistoryPage";
import { TripActivePage } from "@/pages/TripActive/TripActivePage";

/**
 * Снимок `useInfiniteMyTripsQuery`.
 *
 * `error` держим `null`: сейчас эти страницы отдают `error` в `QueryState`,
 * который на нём уводит ленту в терминальный экран. Здесь изолирован ровно
 * контракт F14 — что страница берёт `error` у запроса и передаёт его в
 * `FetchMore`; см. описание устаревшего `isFetchNextPageError` в pin
 * `useInfiniteSentinel.disabled.dom.test.tsx` и замечание в MEMORY.
 */
function tripsState(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items: [TRIP], pagination: { hasMore: true } }] },
    error: null,
    isError: false,
    isLoading: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

const TRIP = {
  id: "t-1",
  status: "active",
  fromCity: "Вологда",
  toCity: "Череповец",
  departureAt: "2030-06-01T09:00:00.000Z",
  time: "09:00",
  price: 450,
  seatsAvailable: 2,
  seatsTotal: 4,
  pendingRequestsCount: 0,
  confirmedBookingsCount: 0,
  autoComplete: false,
  matchingEnabled: true,
};

/** Снимок не-бесконечных запросов: странице нужны только флаги загрузки. */
function plainState(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

/**
 * Контракт F14 в одну строку: плашка `role="alert"` про сбой и кнопка
 * «Повторить загрузку» — пара, которой не должно быть при здоровом запросе.
 */
function expectRetryAffordance() {
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Не удалось загрузить ещё");
  // Кнопка повтора — именованная, а не «та же самая, что раньше»: без смены
  // подписи пользователь не отличил бы сбой от обычной догрузки.
  expect(
    screen.getByRole("button", { name: "Повторить загрузку" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
}

function expectNoRetryAffordance() {
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Не удалось загрузить ещё/)).toBeNull();
  // Здоровая лента сохраняет обычную кнопку догрузки — правка не должна
  // отнимать её у пользователя.
  expect(screen.getByRole("button", { name: "Показать ещё" })).toBeTruthy();
}

function renderPage(ui: React.ReactNode, url: string) {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockPassengerHistory.mockReturnValue(plainState());
  mockMyBookings.mockReturnValue(plainState());
  mockDriverRequests.mockReturnValue(plainState());
  mockTrips.mockReturnValue(tripsState());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TripHistoryPage: сбой догрузки (F14)", () => {
  it("страница N+1 упала — плашка о сбое и «Повторить загрузку»", () => {
    mockTrips.mockReturnValue(
      tripsState({ isFetchNextPageError: true, error: new Error("обрыв") }),
    );

    renderPage(<TripHistoryPage />, "/profile/history");

    expectRetryAffordance();
  });

  it("ошибки нет — обычное «Показать ещё», тревожного текста нет", () => {
    renderPage(<TripHistoryPage />, "/profile/history");

    expectNoRetryAffordance();
  });
});

describe("TripActivePage: сбой догрузки (F14)", () => {
  it("сегмент «Водитель»: сбой догрузки виден и предлагает повтор", () => {
    mockTrips.mockReturnValue(
      tripsState({ isFetchNextPageError: true, error: new Error("обрыв") }),
    );

    renderPage(<TripActivePage />, "/bookings?segment=driver");

    expectRetryAffordance();
  });

  it("сегмент «Все»: второй вызов FetchMore тоже получает error", () => {
    mockTrips.mockReturnValue(
      tripsState({ isFetchNextPageError: true, error: new Error("обрыв") }),
    );

    renderPage(<TripActivePage />, "/bookings");

    expectRetryAffordance();
  });

  it("ошибки нет — обычное «Показать ещё», тревожного текста нет", () => {
    renderPage(<TripActivePage />, "/bookings?segment=driver");

    expectNoRetryAffordance();
  });
});
