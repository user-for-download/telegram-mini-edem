// @vitest-environment jsdom
// Кнопка «Сбросить фильтры» считается от ПРИМЕНЁННОГО набора (submitted),
// а не от формы: сценарий тупика — применить фильтр с 0 результатов,
// вернуть контролы в нейтраль без «Найти» — и кнопка обязана остаться
// рабочей.
//
// SSR-файлы этого не видят: там нет ни кликов, ни смены состояния формы.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseInfiniteTrips, mockUseAllCities } = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseAllCities: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
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

function emptyResult() {
  return {
    data: { pages: [{ items: [], pagination: { page: 1, total: 0, hasMore: false } }] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  };
}

function renderPage(url: string) {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

// Матчеров jest-dom в проекте нет (@testing-library/jest-dom не подключён) —
// проверяем свойство disabled напрямую.
function resetButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Сбросить фильтры",
  }) as HTMLButtonElement;
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

describe("SearchPage: сброс фильтров остаётся доступным при активном запросе", () => {
  it("пустое состояние без фильтров — кнопка сброса законно погашена", () => {
    renderPage("/trips");
    expect(resetButton()).toBeTruthy();
    expect(resetButton().disabled).toBe(true);
  });

  it("пресет даты из URL: сброс доступен, и остаётся доступен после правки неприменяемого контрола", () => {
    // Пресет = применённый фильтр (submitted.dateSegment === "today").
    renderPage("/trips?fromCityId=city-1&segment=today");
    expect(resetButton().disabled).toBe(false);

    // Меняем город, НЕ нажимая «Найти»: форма отличается от применённого
    // набора, но запрос всё ещё отфильтрован по today. Кнопка обязана
    // остаться рабочей — это тот самый тупик, который счёт от submitted чинит.
    //
    // Именно ГОРОД, а не пилюля даты: пилюля применяется сразу (см.
    // SearchPage.dateSegment.test.tsx), состояние «форма нейтральна, запрос
    // отфильтрован» через неё больше недостижимо.
    fireEvent.change(screen.getByLabelText("Откуда"), {
      target: { value: "city-2" },
    });

    // Кнопка сброса считается от submitted, а не от формы.
    expect(resetButton().disabled).toBe(false);
  });

  it("пресет городов из URL: сброс доступен", () => {
    // Deep link с главной: «Москва → Тула» без нажатия «Найти».
    renderPage("/trips?fromCityId=city-1&toCityId=city-2");
    expect(resetButton().disabled).toBe(false);
  });

  it("сброс реально снимает фильтр и чинит запрос", () => {
    renderPage("/trips?segment=today");
    fireEvent.click(resetButton());
    // Запрос уехал без фильтра даты — то есть сброс применился.
    const filters = mockUseInfiniteTrips.mock.calls.at(-1)?.[0];
    expect(filters).toBeUndefined();
  });
});
