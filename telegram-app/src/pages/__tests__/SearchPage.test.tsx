// Рендер-тесты поиска: лента результатов, пустое состояние со сбросом,
// пагинация «Показать ещё», loading/error через QueryState.
// База (инпуты городов, сегменты дат, пресет из URL) покрыта в
// tripsPages.test.tsx «SearchPage parity» — здесь не дублируется.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
});

const { mockUseInfiniteTrips } = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteTripsQuery: mockUseInfiniteTrips,
  };
});

import { SearchPage } from "@/pages/SearchPage";
import { ToastProvider } from "@/components/Toast/ToastProvider";

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

function infiniteState(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    ...queryState(),
    data: { pages: [{ items, pagination: { hasMore: false } }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function render(element: ReactNode, url = "/trips"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
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
    driver: {
      id: "u-1",
      name: "Александр",
      rating: 4.9,
      reviewsCount: 12,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    status: "active",
    ...overrides,
  };
}

describe("SearchPage results", () => {
  it("показывает счётчик и карточки найденных поездок", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([makeTrip(), makeTrip({ id: "t-2", price: 300 })]),
    );
    const html = render(<SearchPage />);
    // SSR разбивает текст комментариями: «Найдено поездок: <!-- -->2».
    expect(html).toContain("Найдено поездок:");
    expect(html).toMatch(/Найдено поездок: <!-- -->2/);
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
  });

  it("пустой результат — плейсхолдер со сбросом фильтров", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toMatch(/Найдено поездок: <!-- -->0/);
    expect(html).toContain("Поездок не найдено");
    expect(html).toContain("Сбросить фильтры");
  });

  it("пагинация: кнопка «Показать ещё» только при hasNextPage", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([makeTrip()], { hasNextPage: true }),
    );
    expect(render(<SearchPage />)).toContain("Показать ещё");

    mockUseInfiniteTrips.mockReturnValue(infiniteState([makeTrip()]));
    expect(render(<SearchPage />)).not.toContain("Показать ещё");
  });
});

describe("SearchPage query states", () => {
  it("loading — спиннер вместо ленты", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([], { isLoading: true, data: undefined }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Загрузка");
    expect(html).not.toContain("Поездок не найдено");
  });

  it("ошибка — повтор через refetch", () => {
    const refetch = vi.fn();
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([], {
        data: undefined,
        isError: true,
        error: new Error("network down"),
        refetch,
      }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});
