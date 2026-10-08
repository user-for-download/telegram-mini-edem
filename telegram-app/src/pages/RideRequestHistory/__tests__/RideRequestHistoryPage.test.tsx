// SSR-тесты страницы «История запросов» (/profile/ride-requests).
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
//
// Страница — тонкая склейка: кнопка «Создать запрос» открывает окно,
// тело — список заявок. Проверяем именно склейку и разделение: форма
// создания живёт в портальном окне (в renderToString не попадает), список —
// на странице.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseRequests } = vi.hoisted(() => ({
  mockUseRequests: vi.fn(),
}));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useRideRequestsQuery: mockUseRequests,
    useUpdateRideRequestMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      variables: undefined,
    })),
    useRideRequestStatusMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      variables: undefined,
    })),
    useCancelRideRequestMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    })),
    useCreateRideRequestMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    })),
  };
});

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: vi.fn(() => ({ data: [] })),
}));

import { RideRequestHistoryPage } from "@/pages/RideRequestHistory/RideRequestHistoryPage";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fromCity: { id: "c-1", name: "Москва" },
    toCity: { id: "c-2", name: "Тула" },
    earliestAt: "2030-01-02T10:00:00.000Z",
    latestAt: "2030-01-02T14:00:00.000Z",
    seats: 2,
    status: "active",
    expiresAt: "2030-01-02T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderPage(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/profile/ride-requests"]}>
        <RideRequestHistoryPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseRequests.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestHistoryPage", () => {
  it("имя экрана скрытым h1, кнопка создания и заголовок списка", () => {
    const html = renderPage();

    expect(html).toContain("История запросов");
    expect(html).toContain("Создать запрос");
    expect(html).toContain("Мои заявки");
  });

  it("список заявок выводится на странице", () => {
    mockUseRequests.mockReturnValue({
      data: [makeRequest()],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPage();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Поставить на паузу");
  });

  it("форма создания не встроена в страницу — она в портальном окне", () => {
    // Регресс на возврат к слипшейся шторке: если форма снова окажется в DOM
    // страницы, окно перестанет быть единственным местом создания.
    mockUseRequests.mockReturnValue({
      data: [makeRequest()],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPage();

    expect(html).not.toContain("Новый запрос");
    expect(html).not.toContain('for="ride-from"');
  });
});
