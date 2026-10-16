// @vitest-environment jsdom
// Регресс F14 (вторая половина): лента «Обо мне» на странице отзывов.
//
// Тот же дефект, что в `tripHistoryPage.fetchMoreError.dom.test.tsx`, но на
// другом экране: `ReviewsPage.tsx:591` звал `FetchMore` без `error`, поэтому
// сбой страницы N+1 выглядел как обычное «Показать ещё».
//
// Файл существует отдельно, а не в общем списке страниц, потому что у Reviews
// есть ещё один слой над `QueryState`: вкладка «Обо мне» рендерится только
// при `tab === "about"`, поэтому контракт проверяется на `ReviewsBody` с
// `initialTab="about"` — так же, как соседние файлы reviewsPage.*.dom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseMyReviews, mockUseAvailableTrips, mockUseInfinite, mockCreate } =
  vi.hoisted(() => ({
    mockUseMyReviews: vi.fn(),
    mockUseAvailableTrips: vi.fn(),
    mockUseInfinite: vi.fn(),
    mockCreate: vi.fn(),
  }));

vi.mock("@/queries/useReviewsQuery", () => ({
  useMyReviewsQuery: mockUseMyReviews,
  useAvailableReviewTripsQuery: mockUseAvailableTrips,
  useUserReviewsInfiniteQuery: mockUseInfinite,
  useCreateReviewMutation: mockCreate,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: () => ({ data: { pages: [] } }),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({
    data: { id: "u-me", name: "Я", rating: 4.8, reviewsCount: 12 },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// SSR-тест ReviewsPage.test.tsx отдаёт пользователя моком хука напрямую
// литералом: фабрика мока поднимается выше объявления, и обращение к
// константе ниже упало бы в TDZ.
vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user: { id: "u-me", name: "Я Водитель" } }),
    {
      setState: () => {},
      getState: () => ({ user: { id: "u-me" } }),
    },
  ),
}));

import { ReviewsBody } from "@/pages/Reviews/ReviewsPage";

/**
 * Снимок `useUserReviewsInfiniteQuery` — ленты «Обо мне».
 *
 * `error` держим `null`, как и в pin'е F13 для архива поездок: сейчас
 * страница отдаёт `error` в `QueryState`, и он уводит ленту в терминальный
 * экран раньше, чем дойдёт до `FetchMore`. Здесь изолирован ровно контракт
 * F14 — что страния берёт `error` у запроса и передаёт его в `FetchMore`.
 */
function aboutState(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      pages: [
        {
          items: [
            {
              id: "r-1",
              rating: 5,
              text: "Отлично",
              createdAt: "2026-09-01T10:00:00.000Z",
              author: { id: "u-a", name: "Пётр" },
            },
          ],
          pagination: { hasMore: true },
        },
      ],
    },
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

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderAbout() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/reviews"]}>
        <ReviewsBody initialTab="about" />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseMyReviews.mockReturnValue(queryState({ data: [] }));
  mockUseAvailableTrips.mockReturnValue(queryState({ data: [] }));
  mockCreate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  mockUseInfinite.mockReturnValue(aboutState());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewsPage, лента «Обо мне»: сбой догрузки (F14)", () => {
  it("страница N+1 упала — плашка о сбое и «Повторить загрузку»", () => {
    mockUseInfinite.mockReturnValue(
      aboutState({ isFetchNextPageError: true, error: new Error("обрыв") }),
    );

    renderAbout();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Не удалось загрузить ещё");
    expect(
      screen.getByRole("button", { name: "Повторить загрузку" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
  });

  it("ошибки нет — обычное «Показать ещё», тревожного текста нет", () => {
    renderAbout();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Не удалось загрузить ещё/)).toBeNull();
    // Правка не должна отнимать у здорового списка обычную кнопку.
    expect(screen.getByRole("button", { name: "Показать ещё" })).toBeTruthy();
  });
});
