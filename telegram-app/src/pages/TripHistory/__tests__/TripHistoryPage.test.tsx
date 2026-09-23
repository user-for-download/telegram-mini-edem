// Рендер-тесты отдельной страницы истории (/profile/history,
// TripHistoryPage): строки маршрутов, слияние архива водителя,
// пустое состояние. Переехали из TripsPage.test.tsx и tripsPages.test.tsx
// после удаления табов Активные/История из TripPage.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHistory.mockReturnValue(queryState({ data: [] }));
  mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
});

const { mockUseHistory, mockUseInfiniteMyTrips } = vi.hoisted(() => ({
  mockUseHistory: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  usePassengerHistoryQuery: mockUseHistory,
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
  };
});

import { TripHistoryPage } from "@/pages/TripHistory/TripHistoryPage";

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

function infiniteState(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ...queryState(),
    data: { pages: [{ items, pagination: { hasMore: false } }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 125,
    distanceKm: 140,
    price: 450,
    seatsTotal: 3,
    seatsAvailable: 2,
    status: "active",
    tags: [],
    ...overrides,
  };
}

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/profile/history"]}>
        {element}
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("TripHistoryPage: строки истории", () => {
  it("история: строки маршрутов с ценой, без вложенного фильтра", () => {
    mockUseHistory.mockReturnValue(
      queryState({
        data: [
          {
            id: "h-1",
            seat: 1,
            status: "confirmed",
            historyCategory: "completed",
            trip: makeTrip({ id: "t-h1" }),
          },
          {
            id: "h-2",
            seat: 1,
            status: "cancelled",
            historyCategory: "cancelled",
            trip: makeTrip({ id: "t-h2", toCity: "Сокол" }),
          },
        ],
      }),
    );
    const html = render(<TripHistoryPage />);
    expect(html).not.toContain("Фильтр истории");
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    expect(html).toContain("Сокол");
    expect(html).toContain("450");
    // Статус текстом: completed → «Завершена», cancelled → «Отменена».
    expect(html).toContain("Завершена");
    expect(html).toContain("Отменена");
  });

  it("архив водителя merged в историю простыми строками", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ id: "t-arch", status: "completed" })]),
    );
    const html = render(<TripHistoryPage />);
    // История — простые Cell без карточек и бейджа «Вы водитель».
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    expect(html).toContain("Завершена");
    expect(html).not.toContain("Вы водитель");
  });

  it("пустая история — плейсхолдер", () => {
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    const html = render(<TripHistoryPage />);
    expect(html).toContain("Здесь появятся завершённые и отменённые поездки.");
  });

  it("история пассажира: статусы текстом, города строками", () => {
    mockUseHistory.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            seat: 1,
            status: "confirmed",
            historyCategory: "completed",
            trip: {
              id: "trip-b-1",
              fromCity: "Москва",
              toCity: "Тула",
              date: "2030-06-01",
              time: "09:00",
              departureAt: "2030-06-01T09:00:00.000Z",
              price: 500,
              driver: { id: "u-d", name: "Иван", avatar: "https://t.me/a.png" },
            },
          },
          {
            id: "b-2",
            seat: 1,
            status: "confirmed",
            historyCategory: "cancelled",
            trip: {
              id: "trip-b-2",
              fromCity: "Тверь",
              toCity: "Тула",
              date: "2030-06-02",
              time: "10:00",
              departureAt: "2030-06-02T10:00:00.000Z",
              price: 400,
              driver: {
                id: "u-d2",
                name: "Пётр",
                avatar: "https://t.me/b.png",
              },
            },
          },
        ],
      }),
    );
    const html = render(<TripHistoryPage />);
    // История — простые строки: чипов фильтра нет, статус — текстом.
    expect(html).not.toContain("Фильтр истории");
    expect(html).toContain("Завершена");
    expect(html).toContain("Отменена");
    expect(html).toContain("Москва");
    expect(html).toContain("Тверь");
  });

  it("архив водителя — plain-строки без «Вы водитель»", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([
        makeTrip({
          id: "t-arch",
          fromCity: "Москва",
          toCity: "Тула",
          status: "completed",
        }),
      ]),
    );
    const html = render(<TripHistoryPage />);
    expect(html).not.toContain("Вы водитель");
    expect(html).toContain("Завершена");
    // SSR разбивает «→» комментариями.
    expect(html).toContain("Москва");
    expect(html).toContain("Тула");
  });
});
