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
});

const { mockUseProfile, mockUseMyBookings } = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseMyBookings: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
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
    expect(html).toContain("Сегодня");
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

  it("сегменты дня и swap не сабмитят форму — переход только по «Найти»", () => {
    // SegmentedControl.Item рендерит <button> без type по умолчанию:
    // в форме такой тап сабмитит поиск и уводит на /trips.
    const html = render(<HomePage />);
    const segmentTags =
      html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
    expect(segmentTags).toHaveLength(3);
    for (const tag of segmentTags) {
      expect(tag).toContain('type="button"');
    }
    const swapTags =
      html.match(/<button[^>]*aria-label="Поменять направление"[^>]*>/g) ?? [];
    expect(swapTags).toHaveLength(1);
    expect(swapTags[0]).toContain('type="button"');
    // Единственный submit формы — CTA «Найти поездку».
    expect(html.match(/type="submit"/g)).toHaveLength(1);
  });
});
