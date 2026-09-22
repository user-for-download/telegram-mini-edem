// Рендер-тесты ReviewsPage без @testing-library/react (не установлен):
// react-dom/server renderToString (среда node, DOM не нужен) + моки хуков:
// 1) Хуки данных мокаются через vi.hoisted + фабрики vi.mock;
//    useAuthStore — настоящий (состояние выставляется через setState).
// 2) PageHeader использует useNavigate — рендерим внутри MemoryRouter.
// 3) Взаимодействие не симулируется: начальная вкладка задаётся пропом
//    initialTab, переключение и сабмит покрыты на уровне query-мутаций
//    и чистой валидации (reviewValidation.test.ts).
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
// (user=null), setState из beforeEach на сервере не виден. Поэтому
// auth-пользователя для этих тестов отдаём моком хука напрямую:
// компоненту нужен только me.id (ветка водителя) и me для about-запроса.
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

import { ReviewsPage, type ReviewsTab } from "@/pages/Reviews/ReviewsPage";
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

const PASSENGER = {
  id: "u-pass",
  name: "Анна Пассажир",
  avatar: "https://t.me/i/userpic/320/pass.svg",
  rating: 4.5,
  reviewsCount: 1,
  tripsCount: 2,
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

function renderPage(tab?: ReviewsTab): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter>
        <ReviewsPage initialTab={tab} />
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

describe("ReviewsPage: структура", () => {
  it("заголовок «Отзывы» и три вкладки (Мои/Новая/Обо мне)", () => {
    setQueries({ my: { data: [makeReview({ status: REVIEW_STATUS.PENDING })] } });

    const html = renderPage();

    expect(html).toContain("Отзывы");
    expect(html).toContain("Мои");
    expect(html).toContain("Новая");
    expect(html).toContain("Обо мне");
  });
});

describe("ReviewsPage: вкладка «Мои» (статусы модерации)", () => {
  it("показывает pending- и published-отзывы вместе с бейджем «На модерации»", () => {
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

    const html = renderPage();

    expect(html).toContain("Пендинг-текст");
    expect(html).toContain("Паблишед-текст");
    expect(html).toContain("На модерации");
  });

  it("rejected-отзыв помечен «Отклонён»", () => {
    setQueries({
      my: {
        data: [
          makeReview({
            id: "r-rejected",
            text: "Отклонённый текст",
            status: REVIEW_STATUS.REJECTED,
          }),
        ],
      },
    });

    const html = renderPage();

    expect(html).toContain("Отклонённый текст");
    expect(html).toContain("Отклонён");
  });

  it("пустое состояние: заголовок + CTA «Оставить отзыв»", () => {
    setQueries({ my: { data: [] } });

    const html = renderPage();

    expect(html).toContain("Вы пока не оставили отзывов");
    expect(html).toContain("Оставить отзыв");
  });

  it("loading — спиннер, ошибка — повтор", () => {
    setQueries({ my: { isLoading: true } });
    expect(renderPage()).toContain('aria-label="Загрузка"');

    setQueries({ my: { isError: true, error: new Error("Нет соединения") } });
    const html = renderPage();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});

describe("ReviewsPage: вкладка «Новая» (доступные поездки + создание)", () => {
  it("направление пассажир → водитель: цель фиксирована, форма с лимитом 150", () => {
    setQueries({ available: { data: [makeTrip()] } });

    const html = renderPage("new");

    expect(html).toContain("Вологда → Череповец");
    // SSR разбивает JSX-текст комментарием: «Отзыв о <!-- -->Имя».
    expect(html).toContain("Отзыв о");
    expect(html).toContain("Иван Водителев");
    expect(html).toContain("Оценка");
    expect(html).toContain("Отправить отзыв");
    // 150-char лимит виден в DOM: браузерный maxLength на textarea.
    expect(html).toMatch(/maxlength="150"/i);
    // Счётчик и ошибка — только после ввода/сабмита.
    expect(html).not.toContain(`/${REVIEW_TEXT_MAX_LENGTH}`);
    expect(html).not.toContain("Максимум");
  });

  it("направление водитель → пассажир: выбор цели из подтверждённых броней", () => {
    setQueries({
      available: { data: [makeTrip({ id: "t-own", driver: ME })] },
      bookings: {
        data: {
          pages: [
            {
              items: [
                { id: "b-1", status: "confirmed", passenger: PASSENGER },
                { id: "b-2", status: "pending", passenger: DRIVER },
              ],
            },
          ],
        },
      },
    });

    const html = renderPage("new");

    expect(html).toContain("Кому оставить отзыв");
    expect(html).toContain("Анна Пассажир");
    // pending-бронь — не цель отзыва.
    expect(html).not.toContain("Иван Водителев");
  });

  it("нет доступных поездок — пустое состояние", () => {
    setQueries({ available: { data: [] } });

    const html = renderPage("new");

    expect(html).toContain("Пока нет поездок для отзыва");
  });
});

describe("ReviewsPage: вкладка «Обо мне» (публичные + рейтинг)", () => {
  it("шапка рейтинга из профиля и только опубликованные отзывы", () => {
    setQueries({
      about: {
        data: {
          pages: [
            {
              items: [makeReview({ id: "r-about", text: "Публичный текст" })],
              pagination: { nextCursor: null, hasMore: false, limit: 20 },
            },
          ],
        },
        hasNextPage: false,
      },
    });

    const html = renderPage("about");

    // Published-only агрегат: рейтинг и счётчик считает backend только
    // по опубликованным (recomputeUserRating), страница его отображает.
    expect(html).toContain("4.8");
    expect(html).toContain("12");
    expect(html).toContain("только опубликованные");
    expect(html).toContain("Публичный текст");
    expect(html).not.toContain("Показать ещё");
  });

  it("пагинация: кнопка «Показать ещё» при hasNextPage", () => {
    setQueries({
      about: {
        data: {
          pages: [
            {
              items: [makeReview()],
              pagination: { nextCursor: "r-1", hasMore: true, limit: 20 },
            },
          ],
        },
        hasNextPage: true,
      },
    });

    expect(renderPage("about")).toContain("Показать ещё");
  });

  it("пустое состояние без CTA", () => {
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

    const html = renderPage("about");

    expect(html).toContain("О вас пока нет отзывов");
    expect(html).not.toContain("Оставить отзыв");
  });
});
