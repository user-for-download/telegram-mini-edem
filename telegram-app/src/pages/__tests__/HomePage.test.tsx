// Рендер-тесты главной: экспресс-поиск (нативные Select-дропдауны),
// профиль-бар с рейтингом (Badge), баннер ближайшей активной брони (Banner),
// CTA водителю (Placeholder), популярные направления. Паттерн
// tripsPages.test.tsx (SSR, без testing-library).
// Данные — только через замокированные queries (profile/bookings),
// моковых сущностей и mockData в коде страницы нет.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/ToastProvider";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseMyTrips.mockReturnValue(queryState({ data: undefined }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue({ mutate: vi.fn() });
});

const {
  mockUseProfile,
  mockUseMyBookings,
  mockUseAllCities,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
  mockUseMyTrips,
} = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
  mockUseMyTrips: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: mockUseMyTrips,
}));

vi.mock("@/queries/useReviewsQuery", () => ({
  useUserReviewsQuery: () => ({ data: [], isLoading: false }),
}));

import { HomePage } from "@/pages/HomePage";

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

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>{element}</MemoryRouter>
      </ToastProvider>
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
    price: 450,
    seatsTotal: 4,
    seatsAvailable: 2,
    driver: { name: "Александр" },
    ...overrides,
  };
}

describe("HomePage", () => {
  it("показывает экспресс-поиск, направления и преимущества", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: { name: "Александр", avatar: "https://t.me/a.png", rating: 4.8 },
      }),
    );
    const html = render(<HomePage />);
    // Профиль-бар с реальным именем и рейтингом из query.
    expect(html).toContain("Александр");
    expect(html).toContain("4.8");
    // Экспресс-поиск — карточка без заголовка.
    expect(html).toContain("Найти поездку");
    // CTA водителю.
    expect(html).toContain("Едете на машине?");
    expect(html).toContain("Создать поездку");
    // Популярные направления (вертикальный список).
    expect(html).toContain("Популярные направления");
    expect(html).toContain("Кириллов");
    // Без данных — все три плашки с нулями.
    expect(html).toContain("Поездки");
    expect(html).toContain("Брони");
    expect(html).toContain("Заявки");
    expect(html).toContain("активных: 0");
  });

  it("сводка: активные поездки за рулём — кнопка «Поездки»", () => {
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                makeTrip({
                  id: "t-own",
                  departureAt: new Date(Date.now() + 3_600_000).toISOString(),
                }),
              ],
            },
          ],
        },
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Поездки");
    expect(html).toContain("активных: 1");
    // Остальные плашки на месте с нулями.
    expect(html).toContain("Брони");
    expect(html).toContain("Заявки");
  });

  it("сводка: брони — кнопка с разбивкой в aria-label", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          { id: "b-1", seat: 1, status: "confirmed", trip: makeTrip() },
          {
            id: "b-2",
            seat: 2,
            status: "pending",
            trip: makeTrip({ id: "t-2", toCity: "Сокол" }),
          },
        ],
      }),
    );
    const html = render(<HomePage />);
    // Есть заявка — кнопка «Ожидают», разбивка в aria-label.
    expect(html).toContain("Ожидают");
    expect(html).toContain("подтверждено: 1, ожидает: 1");
    expect(html).toContain("активных: 0");
  });

  it("сводка: заявки пассажиров — кнопка всегда, бейдж по count", () => {
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest()] }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Заявки");
    expect(html).toContain("новых: 1");
    expect(html).toContain("Поездки");
    expect(html).toContain("Брони");
  });

  it("сводка скрыта при загрузке (без мигания)", () => {
    mockUseMyBookings.mockReturnValue(queryState({ isLoading: true }));
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [{ items: [makeTrip({ id: "t-own" })] }],
        },
        isLoading: true,
      }),
    );
    const html = render(<HomePage />);
    expect(html).not.toContain("Поездки");
    expect(html).not.toContain("Брони");
    expect(html).not.toContain("Заявки");
  });

  it("без сегментов дня — переход только по нативной «Найти»", () => {
    const html = render(<HomePage />);
    // Сегментов дня и swap на экспресс-поиске нет.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("Сегодня");
    expect(html).not.toContain("Поменять направление");
    // Единственный submit формы — нативная tgui-кнопка «Найти поездку»
    // в футере секции (без кастомных классов вроде rounded-full).
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Найти поездку");
    expect(html).not.toContain("rounded-full");
  });

  it("города — нативные Select-дропдауны справочника", () => {
    const html = render(<HomePage />);
    expect(html).toContain("Откуда");
    expect(html).toContain("Куда");
    // Нативный <select> с опциями справочника (placeholder — disabled-опция).
    expect(html.match(/<select/g)?.length).toBe(2);
    expect(html).toContain("Город или село отправления");
    expect(html).toContain("Город или село назначения");
  });

  it("профиль-бар — тап ведёт в профиль", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Александр", rating: 4.8 } }),
    );
    const html = render(<HomePage />);
    // Cell-div с onClick (тапы проверены на iPhone): связь по aria-label.
    expect(html).toContain('aria-label="Открыть профиль"');
    expect(html).toContain("Александр");
  });

  it("сводка заявок водителя: кнопка, без досье на главной", () => {
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest()] }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Заявки");
    // Досье заявки (маршрут, рейтинг, место) — внутри поездки, не на главной.
    expect(html).not.toContain("Вологда → Череповец");
    expect(html).not.toContain("место №1");
  });
});

function makeDriverRequest() {
  return {
    id: "dr-1",
    seat: 1,
    status: "pending",
    expiresAt: null,
    passenger: {
      id: "p-1",
      name: "Пётр",
      avatar: "https://t.me/p.png",
      rating: 4.9,
      reviewsCount: 3,
      tripsCount: 5,
    },
    trip: {
      ...makeTrip(),
      driver: { name: "Я", avatar: "https://t.me/me.png", rating: 5 },
    },
  };
}
