// SSR-тесты ReviewsBody (route-backed ReviewsModal): Modal — портал и в
// renderToString не попадает, поэтому тестируется экспортированное тело.
// Паттерн pages/__tests__/reviewsPage.test.tsx (SSR, без testing-library):
// хуки данных мокаются через vi.hoisted + фабрики vi.mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { REVIEW_STATUS, REVIEW_TEXT_MAX_LENGTH } from "@edem/contracts";

const {
  mockUseMyReviews,
  mockUseAvailableTrips,
  mockUseInfinite,
  mockUseCreate,
  mockUseTripBookings,
  mockUseProfile,
} = vi.hoisted(() => ({
  mockUseMyReviews: vi.fn(),
  mockUseAvailableTrips: vi.fn(),
  mockUseInfinite: vi.fn(),
  mockUseCreate: vi.fn(),
  mockUseTripBookings: vi.fn(),
  mockUseProfile: vi.fn(),
}));

vi.mock("@/queries/useReviewsQuery", () => ({
  useMyReviewsQuery: mockUseMyReviews,
  useAvailableReviewTripsQuery: mockUseAvailableTrips,
  useUserReviewsInfiniteQuery: mockUseInfinite,
  useCreateReviewMutation: mockUseCreate,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
}));

// SSR (renderToString) + zustand: серверный снапшот стора — начальный
// (user=null), поэтому auth-пользователя отдаём моком хука напрямую.
vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        status: "authenticated",
        user: { id: "u-me", name: "Я" },
        session: null,
        banReason: null,
        initData: null,
        lastAuthError: null,
      }),
    { setState: () => {}, getState: () => ({ user: { id: "u-me", name: "Я" } }) },
  ),
}));

import { ReviewsBody, type ReviewsTab } from "@/components/Profile/ReviewsModal";
import { useAuthStore } from "@/store/useAuthStore";

const ME = {
  id: "u-me",
  name: "Я",
  avatar: "https://t.me/i/userpic/320/me.svg",
  rating: 4.8,
  reviewsCount: 12,
  tripsCount: 5,
};

const DRIVER = {
  id: "u-driver",
  name: "Иван Водителев",
  avatar: "https://t.me/i/userpic/320/driver.svg",
  rating: 5,
  reviewsCount: 3,
  tripsCount: 9,
};

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    author: DRIVER,
    targetRole: "driver",
    rating: 5,
    text: "Отличная поездка!",
    status: REVIEW_STATUS.PUBLISHED,
    date: "1 сентября 2026",
    tripRoute: "Вологда → Череповец",
    ...overrides,
  };
}

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "10 сентября",
    time: "09:00",
    durationMinutes: 120,
    distanceKm: 130,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: DRIVER,
    tags: [],
    status: "completed",
    ...overrides,
  };
}

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

function infiniteState(overrides: Record<string, unknown> = {}) {
  return {
    ...queryState(),
    data: { pages: [] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function setQueries(overrides: {
  my?: Record<string, unknown>;
  available?: Record<string, unknown>;
  about?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  bookings?: Record<string, unknown>;
  create?: Record<string, unknown>;
} = {}) {
  mockUseMyReviews.mockReturnValue(queryState({ data: [], ...overrides.my }));
  mockUseAvailableTrips.mockReturnValue(
    queryState({ data: [], ...overrides.available }),
  );
  mockUseInfinite.mockReturnValue(infiniteState(overrides.about));
  mockUseProfile.mockReturnValue(queryState({ data: ME, ...overrides.profile }));
  mockUseTripBookings.mockReturnValue(
    infiniteState({ data: undefined, ...overrides.bookings }),
  );
  mockUseCreate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    ...overrides.create,
  });
}

function renderBody(tab?: ReviewsTab): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/reviews"]}>
        <ReviewsBody initialTab={tab} />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    status: "authenticated",
    user: ME,
    session: null,
    banReason: null,
    initData: null,
    lastAuthError: null,
  });
  setQueries();
});

afterEach(() => {
  useAuthStore.setState({ status: "idle", user: null, session: null });
  vi.clearAllMocks();
});

describe("ReviewsBody: вкладки без PageHeader-back (закрытие — header модалки)", () => {
  it("happy: три вкладки и pending+published отзывы с бейджем «На модерации»", () => {
    setQueries({
      my: {
        data: [
          makeReview({
            id: "r-pending",
            text: "Пендинг-текст",
            status: REVIEW_STATUS.PENDING,
          }),
          makeReview({
            id: "r-published",
            text: "Паблишед-текст",
            status: REVIEW_STATUS.PUBLISHED,
          }),
        ],
      },
    });

    const html = renderBody();

    expect(html).toContain("Мои");
    expect(html).toContain("Новая");
    expect(html).toContain("Обо мне");
    expect(html).toContain("Пендинг-текст");
    expect(html).toContain("Паблишед-текст");
    expect(html).toContain("На модерации");
  });

  it("happy: вкладка «Новая» — форма пассажир → водитель с лимитом 150", () => {
    setQueries({ available: { data: [makeTrip()] } });

    const html = renderBody("new");

    expect(html).toContain("Вологда → Череповец");
    expect(html).toContain("Отзыв о");
    expect(html).toContain("Иван Водителев");
    expect(html).toContain("Оценка");
    expect(html).toContain("Отправить отзыв");
    expect(html).toMatch(/maxlength="150"/i);
    expect(html).not.toContain(`/${REVIEW_TEXT_MAX_LENGTH}`);
  });

  it("edge: нет доступных поездок — пустое состояние", () => {
    setQueries({ available: { data: [] } });

    expect(renderBody("new")).toContain("Пока нет поездок для отзыва");
  });

  it("edge: вкладка «Обо мне» пуста — плейсхолдер без CTA", () => {
    setQueries({
      about: {
        data: {
          pages: [
            {
              items: [],
              pagination: { nextCursor: null, hasMore: false, limit: 20 },
            },
          ],
        },
      },
    });

    const html = renderBody("about");

    expect(html).toContain("О вас пока нет отзывов");
    expect(html).not.toContain("Оставить отзыв");
  });

  it("edge: loading — спиннер, ошибка — повтор", () => {
    setQueries({ my: { isLoading: true } });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setQueries({ my: { isError: true, error: new Error("Нет соединения") } });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});
