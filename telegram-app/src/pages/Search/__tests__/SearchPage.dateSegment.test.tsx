// @vitest-environment jsdom
// Пилюля даты («Сегодня» / «Завтра» / «Все даты») применяет фильтр СРАЗУ,
// без кнопки «Найти»: нажал пилюлю — поехала выдача за этот день.
//
// Регресс на прежнее поведение, где Switcher менял только form, а запрос ехал
// от submitted: пилюля отзывалась визуально, а список оставался прежним до
// нажатия «Найти» под формой — выглядело как «фильтр не работает».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseInfiniteTrips, mockUseAllCities } = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseAllCities: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return { ...original, useInfiniteTripsQuery: mockUseInfiniteTrips };
});
vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));
vi.mock("@tma.js/sdk-react", () => ({
  backButton: { onClick: vi.fn(), offClick: vi.fn() },
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
  miniApp: { ready: { ifAvailable: vi.fn() } },
}));

import { SearchPage } from "@/pages/Search/SearchPage";
import { toIsoDate } from "@/utils/date";

function emptyResult() {
  return {
    data: {
      pages: [{ items: [], pagination: { page: 1, total: 0, hasMore: false } }],
    },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  };
}

function renderPage(url = "/trips") {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

interface AppliedFilters {
  dateFrom?: string;
  dateTo?: string;
  fromCityId?: string;
}

/** Фильтры последнего запроса — то, что реально уехало в ленту. */
function lastFilters(): AppliedFilters | undefined {
  return mockUseInfiniteTrips.mock.calls.at(-1)?.[0];
}

function localIso(date: Date): string {
  return toIsoDate(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(emptyResult());
  mockUseAllCities.mockReturnValue({
    data: [
      { id: "city-1", name: "Вологда" },
      { id: "city-2", name: "Череповец" },
    ],
  });
  // Сентинель автодогрузки: IntersectionObserver в jsdom нет.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchPage: сегмент даты применяется сразу", () => {
  it("«Завтра» фильтрует выдачу без нажатия «Найти»", () => {
    renderPage();
    expect(lastFilters()).toBeUndefined();

    fireEvent.click(screen.getByRole("radio", { name: "Завтра" }));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(lastFilters()).toEqual({
      dateFrom: localIso(tomorrow),
      dateTo: localIso(tomorrow),
    });
  });

  it("«Все даты» снимает фильтр даты тоже сразу", () => {
    renderPage("/trips?segment=today");
    expect(lastFilters()?.dateFrom).toBe(localIso(new Date()));

    fireEvent.click(screen.getByRole("radio", { name: "Все даты" }));

    expect(lastFilters()).toBeUndefined();
  });

  it("пилюля применяет и названные города: результат соответствует видимой форме", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Откуда"), {
      target: { value: "city-1" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Сегодня" }));

    expect(lastFilters()).toMatchObject({
      fromCityId: "city-1",
      dateFrom: localIso(new Date()),
      dateTo: localIso(new Date()),
    });
  });
});
