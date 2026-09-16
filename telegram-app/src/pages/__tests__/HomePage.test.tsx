// Рендер-тесты главной: экспресс-поиск, профиль-бар с рейтингом,
// баннер ближайшей активной брони, CTA водителю, популярные направления,
// преимущества. Паттерн tripsPages.test.tsx (SSR, без testing-library).
// Данные — только через замокированные queries (profile/bookings),
// моковых сущностей и mockData в коде страницы нет.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
});

const { mockUseProfile, mockUseMyBookings, mockUseAllCities } = vi.hoisted(
  () => ({
    mockUseProfile: vi.fn(),
    mockUseMyBookings: vi.fn(),
    mockUseAllCities: vi.fn(),
  }),
);

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
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
      <MemoryRouter initialEntries={["/"]}>{element}</MemoryRouter>
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
    // Популярные направления и преимущества.
    expect(html).toContain("Популярные направления");
    expect(html).toContain("Кириллов");
    expect(html).toContain("Преимущества");
    // Без броней баннера ближайшей поездки нет.
    expect(html).not.toContain("Ближайшая поездка");
  });

  it("показывает баннер ближайшей активной брони", () => {
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
    expect(html).toContain("Ближайшая поездка");
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    // Нативный Cell: subtitle — авто · водитель (без авто — только имя,
    // без "undefined"), дата/время — description, места — с плюрализацией.
    expect(html).toContain("Александр");
    expect(html).not.toContain("undefined");
    expect(html).toContain("2030-06-01 · 09:00");
    // seat — номер места, слово всегда в единственном числе.
    expect(html).toContain("2 место");
    expect(html).not.toContain("2 места");
    // 450 ₽ × 2 места.
    expect(html).toContain("900");
  });

  it("учитывает pending-заявку как активную", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Я", rating: 5 } }),
    );
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [{ id: "b-3", seat: 1, status: "pending", trip: makeTrip() }],
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Ближайшая поездка");
  });

  it("без сегментов дня — переход только по овальной «Найти»", () => {
    const html = render(<HomePage />);
    // Сегментов дня и swap на экспресс-поиске нет.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("Сегодня");
    expect(html).not.toContain("Поменять направление");
    // Единственный submit формы — овальная CTA «Найти поездку» в футере секции.
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Найти поездку");
    expect(html).toContain("rounded-full");
  });

  it("города — пикеры справочника с вводом", () => {
    const html = render(<HomePage />);
    expect(html).toContain("Откуда");
    expect(html).toContain("Куда");
    expect(html).toContain("Город или село отправления");
    expect(html).toContain("Город или село назначения");
  });

  it("профиль-бар — кнопка перехода в профиль", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Александр", rating: 4.8 } }),
    );
    const html = render(<HomePage />);
    const profileTags =
      html.match(/<button[^>]*aria-label="Открыть профиль"[^>]*>/g) ?? [];
    expect(profileTags).toHaveLength(1);
    expect(profileTags[0]).toContain('type="button"');
  });
});
