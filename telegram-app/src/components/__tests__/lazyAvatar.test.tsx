// SSR-тесты P1 LazyAvatar + внедрение в TripFeedCard/ReviewCard/заявки.
// Паттерн tripRequestsModal.test.tsx: renderToString, моки хуков через
// vi.hoisted, без testing-library. Эффекты в renderToString не выполняются,
// поэтому: без IntersectionObserver LazyAvatar сразу показывает контент
// (fallback), с observer (mock, без intersecting) — плейсхолдер loading.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Review, Trip } from "@edem/contracts";

const { mockUseTripBookings, mockUseUpdateBooking } = vi.hoisted(() => ({
  mockUseTripBookings: vi.fn(),
  mockUseUpdateBooking: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useUpdateBookingStatusMutation: mockUseUpdateBooking,
}));

import { LazyAvatar, type LazyAvatarProps } from "@/components/LazyAvatar";
import { TripFeedCard } from "@/components/Trip/TripFeedCard";
import { ReviewCard } from "@/components/ReviewCard";
import { TripRequestsBody } from "@/components/Trip/TripRequestsModal";

const AVATAR_SRC = "https://t.me/i/userpic/320/avatar.svg";

function renderLazy(props: LazyAvatarProps): string {
  return renderToString(
    <AppRoot platform="base">
      <LazyAvatar {...props} />
    </AppRoot>,
  );
}

function makeTrip(): Trip {
  return {
    id: "trip-1",
    fromCity: "Москва",
    toCity: "Тула",
    date: "2026-09-20",
    time: "10:00",
    durationMinutes: 120,
    distanceKm: 180,
    price: 900,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-driver",
      name: "Иван Водителев",
      avatar: AVATAR_SRC,
      rating: 4.8,
      reviewsCount: 12,
      tripsCount: 30,
      isVerified: true,
    },
    tags: [],
  };
}

function makeReview(): Review {
  return {
    id: "r-1",
    author: {
      id: "u-author",
      name: "Анна Пассажирова",
      avatar: AVATAR_SRC,
      rating: 5,
      reviewsCount: 3,
      tripsCount: 7,
    },
    targetRole: "driver",
    rating: 5,
    text: "Отличная поездка, всё вовремя!",
    status: "published",
    date: "2026-09-10",
    tripRoute: "Москва → Тула",
  };
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    status: "pending",
    seat: 2,
    comment: "Еду с рюкзаком",
    passenger: {
      id: "u-pass",
      name: "Анна Пассажирова",
      avatar: AVATAR_SRC,
    },
    ...overrides,
  };
}

function infiniteState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...overrides,
  };
}

function withMockObserver(): void {
  // Observer, который никогда не сообщает intersecting: эффекты в SSR
  // всё равно не выполняются, начальное состояние — плейсхолдер.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

function withoutObserver(): void {
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", undefined);
}

beforeEach(() => {
  withoutObserver();
  mockUseTripBookings.mockReturnValue(
    infiniteState({
      data: { pages: [{ items: [], pagination: { nextCursor: null, hasMore: false } }] },
    }),
  );
  mockUseUpdateBooking.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LazyAvatar SSR: happy/edge", () => {
  it("happy: с src без observer — img с src и alt виден сразу, без падения", () => {
    withoutObserver();

    const html = renderLazy({ src: AVATAR_SRC, acronym: "И", alt: "Иван Водителев" });

    expect(html).toContain(AVATAR_SRC);
    expect(html).toContain('alt="Иван Водителев"');
  });

  it("edge: без src — acronym-fallback без падения и без img", () => {
    const html = renderLazy({ acronym: "А", alt: "Анна Пассажирова" });

    expect(html).toContain("А");
    expect(html).not.toContain("<img");
  });

  it("edge: пустой src — как без src (fallback, без img)", () => {
    const html = renderLazy({ src: "", acronym: "А" });

    expect(html).toContain("А");
    expect(html).not.toContain("<img");
  });

  it("edge: невалидный src рендерится без падения (ошибка загрузки — клиентский onError → тот же acronym-fallback)", () => {
    const html = renderLazy({ src: "not-a-url", acronym: "И", alt: "Иван Водителев" });

    expect(html).toContain("not-a-url");
  });

  it("placeholder при observer без intersecting: aria-label loading, src скрыт", () => {
    withMockObserver();

    const html = renderLazy({ src: AVATAR_SRC, acronym: "И", alt: "Иван Водителев" });

    expect(html).toContain('aria-label="Загрузка аватара"');
    expect(html).toContain('role="status"');
    expect(html).toContain("И");
    expect(html).not.toContain(AVATAR_SRC);
  });

  it("a11y: осмысленный alt по умолчанию и переданный, плейсхолдер с loading-меткой", () => {
    withoutObserver();

    expect(renderLazy({ src: AVATAR_SRC })).toContain('alt="Аватар пользователя"');
    expect(renderLazy({ src: AVATAR_SRC, acronym: "И", alt: "Иван Водителев" })).toContain(
      'alt="Иван Водителев"',
    );

    withMockObserver();
    const placeholder = renderLazy({ src: AVATAR_SRC, acronym: "И" });
    expect(placeholder).toContain('aria-label="Загрузка аватара"');
    expect(placeholder).toContain('role="status"');
  });
});

describe("LazyAvatar в карточках SSR", () => {
  it("TripFeedCard: имя водителя, src аватара и контракт карточки не сломаны", () => {
    withoutObserver();

    const html = renderToString(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <TripFeedCard trip={makeTrip()} />
        </MemoryRouter>
      </AppRoot>,
    );

    expect(html).toContain("Иван Водителев");
    expect(html).toContain(AVATAR_SRC);
    expect(html).toContain("Москва");
    expect(html).toContain("Тула");
    // Эталон SearchTab: вся карточка — кнопка, время → прибытие.
    expect(html).toContain("<button");
    expect(html).toContain("10:00");
    expect(html).toContain("12:00");
    expect(html).toContain("Осталось мест:");
  });

  it("TripFeedCard: пилюля мест — StatusPill с тоном по остатку (0=danger, 1=warning, 2+=success)", () => {
    withoutObserver();

    const renderTripCard = (seatsAvailable: number): string =>
      renderToString(
        <AppRoot platform="base">
          <MemoryRouter initialEntries={["/"]}>
            <TripFeedCard trip={{ ...makeTrip(), seatsAvailable }} />
          </MemoryRouter>
        </AppRoot>,
      );

    const soldOut = renderTripCard(0);
    expect(soldOut).toContain("Мест нет");
    expect(soldOut).toContain('data-tone="danger"');

    const lastSeat = renderTripCard(1);
    expect(lastSeat).toContain("Осталось мест: 1");
    expect(lastSeat).toContain('data-tone="warning"');

    const plenty = renderTripCard(2);
    expect(plenty).toContain("Осталось мест: 2");
    expect(plenty).toContain('data-tone="success"');
  });

  it("ReviewCard: автор, текст и оценка видны, аватар с src", () => {
    withoutObserver();

    const html = renderToString(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <ReviewCard review={makeReview()} />
        </MemoryRouter>
      </AppRoot>,
    );

    expect(html).toContain("Анна Пассажирова");
    expect(html).toContain("Отличная поездка");
    expect(html).toContain(AVATAR_SRC);
    expect(html).toContain("Оценка 5 из 5");
  });

  it("заявки: pending-пассажир с именем и аватаром, действия на месте", () => {
    mockUseTripBookings.mockReturnValue(
      infiniteState({
        data: {
          pages: [{ items: [makeBooking()], pagination: { nextCursor: null, hasMore: false } }],
        },
      }),
    );

    const html = renderToString(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/trips/my/t-1/requests"]}>
          <TripRequestsBody tripId="t-1" />
        </MemoryRouter>
      </AppRoot>,
    );

    expect(html).toContain("Анна Пассажирова");
    expect(html).toContain(AVATAR_SRC);
    expect(html).toContain("Принять");
    expect(html).toContain("Отклонить");
  });
});
