// SSR-тесты страницы «История запросов» (/profile/ride-requests).
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
//
// Страница — только история, как «История поездок»: ни создания, ни
// внутреннего заголовка-дубля. Пустое состояние и лента приходят из
// RideRequestsList; здесь проверяем склейку и отсутствие формы на странице.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Хук списка заявок — бесконечная лента: ответ оборачиваем в одну страницу.
function infiniteState(items: unknown[]) {
  return {
    data: {
      pages: [
        {
          items,
          pagination: {
            page: 1,
            limit: 20,
            total: items.length,
            totalPages: 1,
            hasMore: false,
          },
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
}

beforeEach(() => {
  mockUseRequests.mockReturnValue(infiniteState([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestHistoryPage", () => {
  it("имя экрана и пустое состояние — как в истории поездок", () => {
    const html = renderPage();

    expect(html).toContain("История запросов");
    expect(html).toContain("Пока пусто");
    expect(html).toContain("Здесь появятся ваши запросы на попутку.");
    // Внутреннего заголовка-дубля и кнопки создания на странице нет.
    expect(html).not.toContain("Мои заявки");
    expect(html).not.toContain("Создать запрос");
  });

  it("страница — только история: без секции создания и без окна", () => {
    // Регресс: секция «Нужен попутчик» дублировала главную, а CTA в пустом
    // состоянии делал историю непохожей на «Историю поездок». Создание
    // живёт только на главной.
    const source = readFileSync(
      fileURLToPath(new URL("../RideRequestHistoryPage.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("Нужен попутчик");
    expect(source).not.toContain("<SectionBody>");
    expect(source).not.toContain("RideRequestCreateModal");
    expect(source).not.toContain("Создать запрос");
    expect(source).toContain("<RideRequestsList />");
  });

  it("при наличии запросов лента показывает строки без создания", () => {
    mockUseRequests.mockReturnValue(infiniteState([makeRequest()]));

    const html = renderPage();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Активен");
    expect(html).not.toContain("Создать запрос");
  });

  it("форма создания не встроена в страницу — она только на главной", () => {
    // Регресс на возврат к слипшейся шторке: если форма снова окажется в DOM
    // страницы, окно перестанет быть единственным местом создания.
    mockUseRequests.mockReturnValue(infiniteState([makeRequest()]));

    const html = renderPage();

    expect(html).not.toContain("Новый запрос");
    expect(html).not.toContain('for="ride-from"');
  });
});
