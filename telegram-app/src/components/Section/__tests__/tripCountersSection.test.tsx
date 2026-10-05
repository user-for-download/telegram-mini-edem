// @vitest-environment jsdom
// Счётчик «Заявки» на главной (TripCountersSection).
//
// Регрессия (аудит 2026-10-05): сумма server-side pendingRequestsCount
// считалась только по загруженным активным поездкам, а первая страница —
// limit 20. Водитель с >20 активными поездками видел заниженный счётчик
// (tripStatusLabel в карточке при этом показывал верное число поездки —
// расхождение двух источников).
//
// Решение владельца: догружать остальные страницы ТОЛЬКО когда сумма заведомо
// неполна (tripsTotal > загружено). При ≤20 активных поездках лишних
// запросов нет.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseMyBookings,
  mockUseDriverRequests,
  mockUseInfiniteMyTrips,
} = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
}));
vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return { ...original, useInfiniteMyTripsQuery: mockUseInfiniteMyTrips };
});

import { TripCountersSection } from "@/components/Section/TripCountersSection";

function trip(index: number, pendingRequestsCount?: number) {
  return { id: `t-${index}`, pendingRequestsCount };
}

/** Страница активных поездок: total — то, что насчитал сервер. */
function myTripsState(
  items: unknown[],
  options: { total?: number; hasNextPage?: boolean; isFetchingNextPage?: boolean; isFetchNextPageError?: boolean } = {},
) {
  return {
    data: {
      pages: [
        {
          items,
          pagination: {
            hasMore: options.hasNextPage ?? false,
            // total — то, что насчитал сервер; без него код честно падает
            // обратно на длину загруженного (см. fallback в компоненте).
            total: options.total ?? items.length,
          },
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: mockFetchNextPage,
    hasNextPage: options.hasNextPage ?? false,
    isFetchingNextPage: options.isFetchingNextPage ?? false,
    isFetchNextPageError: options.isFetchNextPageError ?? false,
  };
}

let mockFetchNextPage: ReturnType<typeof vi.fn>;

function tree() {
  return (
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/"]}>
        <TripCountersSection />
      </MemoryRouter>
    </AppRoot>
  );
}

function renderSection() {
  return render(tree());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchNextPage = vi.fn().mockResolvedValue(undefined);
  mockUseMyBookings.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseDriverRequests.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(cleanup);

describe("TripCountersSection: догрузка страниц активных поездок", () => {
  it("≤20 поездок: лишних запросов нет", () => {
    // total === загружено → сумма полна, догружать нечего.
    mockUseInfiniteMyTrips.mockReturnValue(
      myTripsState([trip(1, 2), trip(2, 1)], { total: 2 }),
    );
    renderSection();
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });

  it("total > загружено: страницы догружаются, счётчик считается по всем", () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => trip(i, 1));
    mockUseInfiniteMyTrips.mockReturnValue(
      myTripsState(firstPage, { total: 25, hasNextPage: true }),
    );
    const { rerender } = renderSection();

    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);

    // Страница догрузилась — сумма полна, повторных запросов нет.
    const allTrips = Array.from({ length: 25 }, (_, i) => trip(i, 1));
    mockUseInfiniteMyTrips.mockReturnValue(myTripsState(allTrips, { total: 25 }));
    rerender(tree());
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("ошибка догрузки останавливает попытки (нет бесконечного цикла)", () => {
    // Без isFetchNextPageError в условии был бы цикл запросов: hasNextPage
    // остаётся true, а isFetchingNextPage снова false.
    mockUseInfiniteMyTrips.mockReturnValue(
      myTripsState(Array.from({ length: 20 }, (_, i) => trip(i, 1)), {
        total: 25,
        hasNextPage: true,
        isFetchNextPageError: true,
      }),
    );
    const { rerender } = renderSection();
    rerender(tree());
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });

  it("идущая догрузка не порождает второй запрос", () => {
    mockUseInfiniteMyTrips.mockReturnValue(
      myTripsState(Array.from({ length: 20 }, (_, i) => trip(i, 1)), {
        total: 25,
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    );
    const { rerender } = renderSection();
    rerender(tree());
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });

  it("hasNextPage=false, даже если total больше: догружать нечего", () => {
    // Страницы кончились — что бы сервер ни показывал в total, запросов
    // больше не сделать.
    mockUseInfiniteMyTrips.mockReturnValue(
      myTripsState([trip(1, 1)], { total: 99, hasNextPage: false }),
    );
    renderSection();
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });
});
