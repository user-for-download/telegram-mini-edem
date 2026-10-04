// Рендер-тесты страниц поездок/броней: TripPage — только активные
// (TripActivePage), история отдельно (TripHistoryPage.test.tsx),
// счётчики заявок водителя, confirm-guards, фильтры поиска. Паттерн
// reviewsPage.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

// Дефолты для всех моков-хуков: пустые данные, чтобы каждый тест
// переопределял только то, что проверяет.
beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
  mockUseInfiniteMyTrips.mockReturnValue(infiniteState([]));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseHistory.mockReturnValue(queryState({ data: [] }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseCancelTrip.mockReturnValue(mutation());
  mockUseCompleteTrip.mockReturnValue(mutation());
  mockUseCancelBooking.mockReturnValue(mutation());
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue(mutation());
});

const {
  mockUseInfiniteTrips,
  mockUseInfiniteMyTrips,
  mockUseCancelTrip,
  mockUseCompleteTrip,
  mockUseMyBookings,
  mockUseHistory,
  mockUseCancelBooking,
  mockUseAllCities,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
} = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseHistory: vi.fn(),
  mockUseCancelBooking: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteTripsQuery: mockUseInfiniteTrips,
    useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
    useCancelTripMutation: mockUseCancelTrip,
    useCompleteTripMutation: mockUseCompleteTrip,
  };
});

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  usePassengerHistoryQuery: mockUseHistory,
  useCancelBookingMutation: mockUseCancelBooking,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ data: { rating: 5 } }),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

import { SearchPage } from "@/pages/Search/SearchPage";
import { TripPage } from "@/pages/Trip/TripPage";
import { normalizeSegment } from "@/pages/TripActive/TripActivePage";
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

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function render(element: ReactNode, url = "/"): string {
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
    fromCity: "Москва",
    toCity: "Тула",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 120,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-me",
      name: "Я",
      rating: 5,
      reviewsCount: 1,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    status: "active",
    pendingRequestsCount: 2,
    confirmedBookingsCount: 1,
    ...overrides,
  };
}

describe("TripPage parity", () => {
  it("дефолт — сегмент «Все», пусто — ссылка на историю", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseCancelBooking.mockReturnValue(mutation());
    const html = render(<TripPage />);
    // Поиск + чипы трёх сегментов вверху; табов больше нет.
    expect(html).not.toContain("Активные");
    expect(html).toContain("Поиск");
    expect(html).toContain("Все");
    expect(html).toContain("Водитель");
    expect(html).toContain("Пассажир");
    // Пусто → подсказка + кнопка истории.
    expect(html).toContain("Пока тихо");
    expect(html).toContain("История поездок");
  });

  it("shows active booking cards with guarded cancel", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            seat: 2,
            status: "pending",
            trip: makeTrip({ id: "t-9", fromCity: "Москва", toCity: "Тула" }),
          },
        ],
      }),
    );
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseCancelBooking.mockReturnValue(mutation());
    const html = render(<TripPage />, "/bookings?segment=bookings");
    expect(html).toContain("Отменить");
    expect(html).toContain("На рассмотрении");
    expect(html).toContain("место №2");
  });

  it("renders driver trips with request rows and guarded actions on active", () => {
    mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
    mockUseHistory.mockReturnValue(queryState({ data: [] }));
    mockUseInfiniteMyTrips.mockReturnValue(infiniteState([makeTrip()]));
    mockUseCancelTrip.mockReturnValue(mutation());
    mockUseCompleteTrip.mockReturnValue(mutation());
    mockUseDriverRequests.mockReturnValue(
      queryState({
        data: [
          {
            id: "req-1",
            seat: 1,
            status: "pending",
            trip: { id: "t-1" },
            passenger: { name: "Пётр" },
          },
        ],
      }),
    );
    // Активные (легаси-сегмент игнорируется).
    const html = render(<TripPage />, "/bookings?segment=driving");
    expect(html).toContain("Заявки: 2");
    // Заявки — строки с −/+ вместо «Вы водитель».
    expect(html).toContain("Пётр");
    expect(html).toContain("Принять заявку Пётр");
    expect(html).not.toContain("Вы водитель");
    // Единый футер без Управления/Завершить (детали — тап по карточке).
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Управление поездкой");
    expect(html).not.toContain("Завершить");
  });
});

// Справочник для селектов: id как в БД, имена видимы в тексте опций.
const VOL = "11111111-1111-4111-8111-111111111111";
const CHE = "22222222-2222-4222-8222-222222222222";
const CITIES = [
  { id: VOL, name: "Вологда" },
  { id: CHE, name: "Череповец" },
];

describe("SearchPage parity", () => {
  it("exposes city inputs, date segments and filter entry", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    // Плейсхолдер селекта (свободного текста здесь больше нет — город
    // выбирается из справочника, решение владельца 2026-10-03).
    expect(html).toContain("Город или село отправления");
    expect(html).toContain("Город или село назначения");
    expect(html).toContain("Все даты");
    expect(html).toContain("Сегодня");
    expect(html).toContain("Завтра");
    expect(html).toContain("Фильтры");
    expect(html).toContain("Ищу попутку");
    expect(html).toContain("Найти");
    expect(html).toContain("Найдено поездок");
  });

  it("applies a city preset from the URL", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    mockUseAllCities.mockReturnValue(queryState({ data: CITIES }));
    const html = render(
      <SearchPage />,
      `/trips?fromCityId=${VOL}&toCityId=${CHE}&segment=today`,
    );
    // Пресет выбирает ОПЦИЮ по id: значение селекта = id, текст опции = имя.
    expect(html).toContain(`value="${VOL}" selected`);
    expect(html).toContain(`value="${CHE}" selected`);
  });
});

/**
 * B7: полная таблица токенов ?segment. «driving» — драйвер, а не «Все»:
 * именно его шлют счётчик «Поездки» на главной, действия экрана заявок
 * водителя и deep-link my_trips. Прежний маппинг в «Все» уводил все
 * три точки входа не туда.
 */
describe("normalizeSegment: таблица токенов ?segment", () => {
  it("driver: канонический + driving + легаси requests", () => {
    expect(normalizeSegment("driver")).toBe("driver");
    expect(normalizeSegment("driving")).toBe("driver");
    expect(normalizeSegment("requests")).toBe("driver");
  });

  it("passenger: канонический + легаси bookings", () => {
    expect(normalizeSegment("passenger")).toBe("passenger");
    expect(normalizeSegment("bookings")).toBe("passenger");
  });

  it("all: явный, легаси active, пусто, null и мусор", () => {
    expect(normalizeSegment("all")).toBe("all");
    expect(normalizeSegment("active")).toBe("all");
    expect(normalizeSegment(null)).toBe("all");
    expect(normalizeSegment("")).toBe("all");
    expect(normalizeSegment("history")).toBe("all");
    expect(normalizeSegment("ДРАЙВЕР")).toBe("all");
  });

  it("?segment=driving рендерит только водительское (бронь пассажира не попадает)", () => {
    // Регрессия B7 на уровне страницы: при старе маппинге «driving» уезжал
    // в «Все», где список смешивает поездки за рулём и брони пассажира —
    // и счётчик «Поездки» с главной вёл на смешанный список.
    mockUseInfiniteMyTrips.mockReturnValue(
      infiniteState([makeTrip({ pendingRequestsCount: 0 })]),
    );
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          {
            id: "b-1",
            status: "confirmed",
            scope: "active",
            seat: 1,
            trip: {
              ...makeTrip({ id: "t-2", fromCity: "Тула", toCity: "Смоленск" }),
              driver: { id: "u-other", name: "Другой", rating: 4, reviewsCount: 3 },
            },
          },
        ],
      }),
    );

    const driverOnly = render(<TripPage />, "/bookings?segment=driving");
    expect(driverOnly).toContain("Вы водитель");
    expect(driverOnly).toContain("Москва");
    expect(driverOnly).not.toContain("Смоленск");
    expect(driverOnly).not.toContain("Другой");

    // Контроль: сегмент «Все» по-прежнему смешанный.
    const allSegments = render(<TripPage />, "/bookings?segment=all");
    expect(allSegments).toContain("Вы водитель");
    expect(allSegments).toContain("Другой");
  });
});
