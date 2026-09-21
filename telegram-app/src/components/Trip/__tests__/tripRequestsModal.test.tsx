// SSR-тесты TripRequestsBody (тело route-backed модалки
// /trips/my/:tripId/requests). Modal — портал и в renderToString не
// попадает, поэтому тестируется экспортированное тело. Паттерн
// notificationsModal.test.tsx (SSR, моки хуков через vi.hoisted, без
// testing-library). useOnlineStatus SSR-safe (server snapshot true) —
// мок не нужен.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

const { mockUseTripBookings, mockUseUpdateBooking } = vi.hoisted(() => ({
  mockUseTripBookings: vi.fn(),
  mockUseUpdateBooking: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useUpdateBookingStatusMutation: mockUseUpdateBooking,
}));

import { TripRequestsBody } from "@/components/Trip/TripRequestsModal";

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    status: "pending",
    seat: 2,
    comment: "Еду с рюкзаком",
    passenger: {
      id: "u-pass",
      name: "Анна Пассажирова",
      avatar: "https://t.me/i/userpic/320/pass.svg",
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

function setMocks(
  requests: Record<string, unknown> = {},
  update: Record<string, unknown> = {},
) {
  mockUseTripBookings.mockReturnValue(infiniteState(requests));
  mockUseUpdateBooking.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
    ...update,
  });
}

const pageWithItems = (items: Array<Record<string, unknown>>) => ({
  data: { pages: [{ items, pagination: { nextCursor: null, hasMore: false } }] },
});

function renderBody(tripId = "t-1"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[`/trips/my/${tripId}/requests`]}>
        <TripRequestsBody tripId={tripId} />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks(pageWithItems([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TripRequestsBody: списки без PageHeader-back", () => {
  it("happy: pending-заявка с именем, местом и Принять/Отклонить", () => {
    setMocks(pageWithItems([makeBooking()]));

    const html = renderBody();

    expect(html).toContain("Ожидают решения (1)");
    expect(html).toContain("Анна Пассажирова");
    expect(html).toContain("место 2");
    expect(html).toContain("Принять");
    expect(html).toContain("Отклонить");
    expect(html).toContain("Ожидает решения");
  });

  it("happy: confirmed-пассажир с бейджем «Подтверждён»", () => {
    setMocks(
      pageWithItems([
        makeBooking({ id: "b-2", status: "confirmed", comment: undefined }),
      ]),
    );

    const html = renderBody();

    expect(html).toContain("Подтверждены (1)");
    expect(html).toContain("Подтверждён");
  });

  it("edge: пустые заявки — плейсхолдер без списков", () => {
    setMocks(pageWithItems([]));

    const html = renderBody();

    expect(html).toContain("Заявок нет");
    expect(html).not.toContain("Ожидают решения (");
    expect(html).not.toContain("Подтверждены (");
  });

  it("PageHeader внутрь модалки не рендерится (закрытие — header модалки)", () => {
    setMocks(pageWithItems([makeBooking()]));

    expect(renderBody()).not.toContain("pt-5 pb-3");
  });
});

describe("TripRequestsBody: состояния запроса", () => {
  it("loading — спиннер, ошибка — повтор и «К моим поездкам»", () => {
    setMocks({ isLoading: true });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить заявки");
    expect(html).toContain("Повторить");
    expect(html).toContain("К моим поездкам");
  });

  it("403 — «Нет доступа»: заявок видит только водитель, без «Повторить»", () => {
    setMocks({
      isError: true,
      error: new ApiError("Forbidden", "FORBIDDEN", 403),
    });

    const html = renderBody();

    expect(html).toContain("Нет доступа");
    expect(html).toContain("Заявки видит только водитель поездки");
    expect(html).not.toContain("Повторить");
  });

  it("пагинация: кнопка «Показать ещё» при следующей странице", () => {
    setMocks({ ...pageWithItems([makeBooking()]), hasNextPage: true });

    expect(renderBody()).toContain("Показать ещё");
  });
});

describe("TripRequestsBody: a11y", () => {
  it("секция с именем, live-регионы, таргеты ≥44px", () => {
    setMocks(pageWithItems([makeBooking()]));

    const html = renderBody();

    expect(html).toContain('aria-label="Заявки пассажиров"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("min-h-11");
  });
});
