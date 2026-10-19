// @vitest-environment jsdom
// Регресс F6: падение `useTripBookingsQuery` (список подтверждённых пассажиров
// поездки) обязано давать терминальное состояние с «Повторить», а НЕ молча
// гасящую кнопку «Отправить отзыв» (MEMORY.md §18 — сетевая ошибка не
// является ошибкой валидации).
//
// Сломанный код читает запрос только как `data?.pages.flatMap(...)`: при
// ошибке `passengers` = [], `targetUser` = null, `canSubmit` = false — кнопка
// «Отправить отзыв» выключена навсегда, ни слова пользователю, а ветка
// «Не найден пользователь» (это как раз ЧЕСТНЫЙ пустой ответ сервера)
// спрятана за этой кнопкой и недостижима.
//
// Поэтому проверки НЕ «кнопка disabled»: такая проверка прошла бы и на
// сломанном коде. Проверяем, что (а) есть видимый, доступный с клавиатуры
// «Повторить», (б) его нажатие действительно зовёт refetch и приводит к
// данным — так ведёт себя только живой onRetry, (в) рядом нет ни одного
// слова про «выберите/добавьте», то есть сетевой сбой не подан как вина
// пользователя.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseMyReviews,
  mockUseAvailableTrips,
  mockUseInfinite,
  mockUseCreate,
} = vi.hoisted(() => ({
  mockUseMyReviews: vi.fn(),
  mockUseAvailableTrips: vi.fn(),
  mockUseInfinite: vi.fn(),
  mockUseCreate: vi.fn(),
}));

/** Снапшот запроса броней: ровно те поля, которые читает ReviewsBody. */
interface BookingsSnapshot {
  data: { pages: Array<{ items: unknown[] }> } | undefined;
  error: unknown;
  isLoading: boolean;
  isError: boolean;
}

const PAGE = { pagination: { nextCursor: null, hasMore: false } };

// Снапшот живёт во внешнем сторе: смена снапшота перерисовывает подписчиков
// ровно так, как это делает useQuery на успешном refetch, поэтому «повтор»
// проверяется поведением, а не наличием слова «Повторить».
const bookings = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store: {
    refetch: ReturnType<typeof vi.fn>;
    snapshot: BookingsSnapshot;
    set(next: BookingsSnapshot): void;
    subscribe(listener: () => void): () => void;
  } = {
    refetch: vi.fn(),
    snapshot: {
      data: undefined,
      error: new Error("Сеть недоступна"),
      isLoading: false,
      isError: true,
    },
    set(next) {
      store.snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return store;
});

bookings.refetch.mockImplementation(() => {
  bookings.set({
    data: {
      pages: [{ items: [{ status: "confirmed", passenger: P1 }], ...PAGE }],
    },
    error: null,
    isLoading: false,
    isError: false,
  });
  return Promise.resolve({});
});

vi.mock("@/queries/useReviewsQuery", () => ({
  useMyReviewsQuery: mockUseMyReviews,
  useAvailableReviewTripsQuery: mockUseAvailableTrips,
  useUserReviewsInfiniteQuery: mockUseInfinite,
  useCreateReviewMutation: mockUseCreate,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: () => ({
    ...useSyncExternalStore(bookings.subscribe, () => bookings.snapshot),
    refetch: bookings.refetch,
  }),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({
    data: { id: "u-me", name: "Я Водитель", rating: 4.8, reviewsCount: 12 },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// SSR-тест ReviewsPage.test.tsx подменяет стор тем же приёмом: автора отзыва
// отдаём хуком напрямую литералом (иначе обращение к константе ниже упало бы
// в TDZ — фабрика мока поднимается выше объявления).
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

/** Автор отзыва — водитель поездки: только ему нужен список пассажиров. */
const ME = {
  id: "u-me",
  name: "Я Водитель",
  avatar: "https://t.me/i/userpic/320/me.svg",
  rating: 4.8,
  reviewsCount: 12,
  tripsCount: 5,
};

const P1 = { id: "u-p1", name: "Пётр Первый" };

const TRIP = {
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
  driver: ME,
  tags: [],
  status: "completed",
};

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

function renderBody() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/reviews"]}>
        <ReviewsBody initialTab="new" />
      </MemoryRouter>
    </AppRoot>,
  );
}

/** Слова, которыми сеть не может быть виновата: их на экране быть не должно. */
const VALIDATION_WORDS = [
  /Выберите поездку/,
  /Не найден пользователь/,
  /Добавьте комментарий/,
  /нет пассажиров/i,
];

function expectNoValidationWording() {
  for (const word of VALIDATION_WORDS) {
    expect(screen.queryByText(word)).toBeNull();
  }
}

beforeEach(() => {
  bookings.snapshot = {
    data: undefined,
    error: new Error("Сеть недоступна"),
    isLoading: false,
    isError: true,
  };
  bookings.refetch.mockClear();
  mockUseMyReviews.mockReturnValue(queryState({ data: [] }));
  mockUseAvailableTrips.mockReturnValue(queryState({ data: [TRIP] }));
  mockUseInfinite.mockReturnValue({
    ...queryState(),
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  mockUseCreate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewsBody: падение списка пассажиров (tripBookings)", () => {
  it("показывает «Повторить» и НЕ оставляет выключенную кнопку отправки", () => {
    renderBody();

    // Видимый и доступный с клавиатуры повтор — это и есть терминальное
    // состояние. На сломанном коде здесь нет ничего.
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();

    // Кнопка отправки не «выключена молча», а просто не предлагает действие,
    // которого выполнить нельзя.
    expect(
      screen.queryByRole("button", { name: /Отправить отзыв/ }),
    ).toBeNull();

    // Сетевой сбой не выдаётся за ошибку валидации пользователя.
    expectNoValidationWording();
  });

  it("«Повторить» действительно перезапрашивает бронь и приводит к форме", () => {
    renderBody();
    expect(bookings.refetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    expect(bookings.refetch).toHaveBeenCalledTimes(1);
    // Данные пришли — пассажир появился в выборе, повтор больше не нужен.
    expect(
      (screen.getByLabelText("Кому оставить отзыв") as HTMLSelectElement).value,
    ).toBe(P1.id);
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Отправить отзыв/ }),
    ).toBeTruthy();
  });
});

describe("ReviewsBody: выбор пассажира не молчит", () => {
  it("пока загрузка — выбор заблокирован с подписью, а не пустой молча", () => {
    bookings.set({
      data: undefined,
      error: null,
      isLoading: true,
      isError: false,
    } satisfies BookingsSnapshot);

    renderBody();

    const select = screen.getByLabelText(
      "Кому оставить отзыв",
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain("Загрузка");
  });

  it("сервер ответил и пассажиров нет — это не «список пуст из-за ошибки»", () => {
    bookings.set({
      data: { pages: [{ items: [], ...PAGE }] },
      error: null,
      isLoading: false,
      isError: false,
    } satisfies BookingsSnapshot);

    renderBody();

    // Ветка «Не найден пользователь» достижима — только для честного пустого
    // ответа сервера.
    expect(screen.getByText(/Не найден пользователь/)).toBeTruthy();
    // Повтор тут не нужен: запрос отработал успешно.
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    // Выключенная кнопка объяснена — рядом висит сообщение о пустом списке.
    const submit = screen.getByRole("button", {
      name: /Отправить отзыв/,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("ReviewsBody: happy path не сломан", () => {
  it("при данных кнопка отправки включается, как только написан комментарий", () => {
    bookings.set({
      data: {
        pages: [{ items: [{ status: "confirmed", passenger: P1 }], ...PAGE }],
      },
      error: null,
      isLoading: false,
      isError: false,
    } satisfies BookingsSnapshot);

    renderBody();

    const submit = screen.getByRole("button", {
      name: /Отправить отзыв/,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Комментарий"), {
      target: { value: "Отличная поездка" },
    });

    expect(submit.disabled).toBe(false);
  });
});
