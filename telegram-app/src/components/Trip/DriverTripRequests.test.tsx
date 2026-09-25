// SSR-тесты DriverTripRequests (F7): при пустом списке заявок компонент
// возвращает null — заголовок/счётчик «Заявки: N» не рендерится, take 50
// общего запроса не трогаем. Паттерн tripRequestsModal.test.tsx (SSR,
// моки хуков через vi.hoisted, без testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseDriverRequests, mockUseUpdateBookingStatus } = vi.hoisted(
  () => ({
    mockUseDriverRequests: vi.fn(),
    mockUseUpdateBookingStatus: vi.fn(),
  }),
);

vi.mock("@/queries/useBookingsQuery", () => ({
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { ToastProvider } from "@/components/Toast/ToastProvider";

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    seat: 1,
    status: "pending",
    comment: "еду с рюкзаком",
    trip: { id: "t-1" },
    passenger: { name: "Пётр", avatar: undefined, rating: 4.8 },
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

function setMocks(
  query: Record<string, unknown> = {},
  mutation: Record<string, unknown> = {},
) {
  mockUseDriverRequests.mockReturnValue(queryState(query));
  mockUseUpdateBookingStatus.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
    ...mutation,
  });
}

function renderBare(tripId = "t-1"): string {
  return renderToString(
    <MemoryRouter initialEntries={["/bookings?segment=driver"]}>
      <ToastProvider>
        <DriverTripRequests tripId={tripId} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function renderApp(tripId = "t-1"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings?segment=driver"]}>
        <ToastProvider>
          <DriverTripRequests tripId={tripId} />
        </ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DriverTripRequests F7: пустой список — null", () => {
  it("пустой массив — null: без счётчика, строк и скелетона", () => {
    setMocks({ data: [] });

    expect(renderBare()).toBe("");

    const html = renderApp();
    expect(html).not.toContain("Заявки");
    expect(html).not.toContain("Загрузка заявок");
    expect(html).not.toContain("Повторить");
  });

  it("чужой tripId отфильтрован — null", () => {
    setMocks({
      data: [makeBooking({ id: "req-other", trip: { id: "t-2" } })],
    });

    expect(renderBare("t-1")).toBe("");
    expect(renderApp("t-1")).not.toContain("Пётр");
  });

  it("только non-pending на этот tripId — null", () => {
    setMocks({
      data: [makeBooking({ status: "confirmed", comment: undefined })],
    });

    expect(renderBare()).toBe("");
  });
});

describe("DriverTripRequests: непустые состояния", () => {
  it("happy: pending-заявка с именем, местом и −/+", () => {
    setMocks({ data: [makeBooking()] });

    const html = renderApp();

    expect(html).toContain("Пётр");
    expect(html).toContain("место №1");
    expect(html).toContain("еду с рюкзаком");
    expect(html).toContain("Отклонить заявку Пётр");
    expect(html).toContain("Принять заявку Пётр");
  });

  it("loading — скелетон без строк", () => {
    setMocks({ isLoading: true });

    const html = renderApp();

    expect(html).toContain('aria-label="Загрузка заявок"');
    expect(html).not.toContain("Пётр");
  });

  it("error — alert и «Повторить»", () => {
    setMocks({ isError: true, error: new Error("network down") });

    const html = renderApp();

    expect(html).toContain('role="alert"');
    expect(html).toContain("network down");
    expect(html).toContain("Повторить");
  });
});
