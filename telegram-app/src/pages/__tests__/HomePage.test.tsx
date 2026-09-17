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
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue({ mutate: vi.fn() });
});

const { mockUseProfile, mockUseMyBookings, mockUseAllCities, mockUseDriverRequests, mockUseUpdateBookingStatus } = vi.hoisted(
  () => ({
    mockUseProfile: vi.fn(),
    mockUseMyBookings: vi.fn(),
    mockUseAllCities: vi.fn(),
    mockUseDriverRequests: vi.fn(),
    mockUseUpdateBookingStatus: vi.fn(),
  }),
);

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
    // Экспресс-поиск.
    expect(html).toContain("Куда поедем?");
    expect(html).toContain("Найти поездку");
    // CTA водителю.
    expect(html).toContain("Едете на машине?");
    expect(html).toContain("Создать поездку");
    // Популярные направления (вертикальный список).
    expect(html).toContain("Популярные направления");
    expect(html).toContain("Кириллов");
    // Без броней секций броней нет.
    expect(html).not.toContain("Ваша поездка");
    expect(html).not.toContain("Ожидают подтверждения");
  });

  it("показывает confirmed-бронь в секции «Ваша поездка»", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Я", rating: 5 } }),
    );
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          { id: "b-2", seat: 1, status: "cancelled", trip: makeTrip() },
          {
            id: "b-1",
            seat: 2,
            status: "confirmed",
            trip: makeTrip(),
          },
        ],
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Ваша поездка");
    expect(html).not.toContain("Ожидают подтверждения");
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    // Banner: авто · водитель (без "undefined"), дата/время, места/цена.
    expect(html).toContain("Александр");
    expect(html).not.toContain("undefined");
    expect(html).toContain("2030-06-01 · 09:00");
    // seat — плюрализация форматаSeats: 2 → «2 места».
    expect(html).toContain("2 места");
    expect(html).not.toContain("2 мест ·");
    // 450 ₽ × 2 места.
    expect(html).toContain("900");
  });

  it("показывает pending-бронь в секции «Ожидают подтверждения»", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Я", rating: 5 } }),
    );
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [{ id: "b-3", seat: 1, status: "pending", trip: makeTrip() }],
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Ожидают подтверждения");
    expect(html).not.toContain("Ваша поездка");
    // Статус задан заголовком секции — в описании баннера не дублируется.
    expect(html).not.toContain("Подтверждено");
  });

  it("разделяет confirmed и pending по разным секциям одновременно", () => {
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
    expect(html).toContain("Ваша поездка");
    expect(html).toContain("Ожидают подтверждения");
    expect(html).toContain("Череповец");
    expect(html).toContain("Сокол");
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

  it("показывает сводку заявок водителя с рейтингом пассажира", () => {
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest()] }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Заявки на поездки");
    expect(html).toContain("Вологда → Череповец");
    // Рейтинг пассажира — бейджем на аватаре.
    expect(html).toContain("4.9");
    // Плюрализация мест в subtitle.
    expect(html).toContain("1 место");
    // Единственное действие в списке — «+» (решение внутри досье).
    expect(html).toContain('aria-label="Открыть заявку Пётр"');
    expect(html).not.toContain("Одобрить заявку");
    expect(html).not.toContain("Отказать");
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
