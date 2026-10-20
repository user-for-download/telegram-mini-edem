// @vitest-environment jsdom
// Тап по строке заявки открывает шторку управления, а не действия inline.
//
// SSR-тест списка проверяет состав строк, но не клик: портал Sheet в
// renderToString не попадает. Здесь — один сквозной сценарий на реальном
// DOM, чтобы «обычное поведение как в других лентах» не осталось только в
// комментарии.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseRequests, mockUseUpdate, mockUseStatus, mockUseCancel } =
  vi.hoisted(() => ({
    mockUseRequests: vi.fn(),
    mockUseUpdate: vi.fn(),
    mockUseStatus: vi.fn(),
    mockUseCancel: vi.fn(),
  }));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useRideRequestsQuery: mockUseRequests,
    useUpdateRideRequestMutation: mockUseUpdate,
    useRideRequestStatusMutation: mockUseStatus,
    useCancelRideRequestMutation: mockUseCancel,
  };
});

import { RideRequestsList } from "@/components/Trip/RideRequestsList";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function mutationState() {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  };
}

function requestsState() {
  return {
    data: {
      pages: [
        {
          items: [
            {
              id: REQUEST_ID,
              fromCity: { id: "c-1", name: "Москва" },
              toCity: { id: "c-2", name: "Тула" },
              earliestAt: "2030-01-02T10:00:00.000Z",
              latestAt: "2030-01-02T14:00:00.000Z",
              seats: 2,
              status: "active",
              expiresAt: "2030-01-02T10:00:00.000Z",
              createdAt: "2026-09-01T10:00:00.000Z",
              updatedAt: "2026-09-01T10:00:00.000Z",
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
            hasMore: false,
          },
        },
      ],
    },
    error: null,
    isError: false,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

function emptyRequestsState() {
  const state = requestsState();
  return {
    ...state,
    data: {
      pages: [
        {
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
            hasMore: false,
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  mockUseRequests.mockReturnValue(requestsState());
  mockUseUpdate.mockReturnValue(mutationState());
  mockUseStatus.mockReturnValue(mutationState());
  mockUseCancel.mockReturnValue(mutationState());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RideRequestsList: создание только в пустом состоянии", () => {
  it("пустой список: CTA вызывает onCreate", () => {
    const onCreate = vi.fn();
    mockUseRequests.mockReturnValue(emptyRequestsState());

    render(
      <AppRoot platform="base">
        <RideRequestsList onCreate={onCreate} />
      </AppRoot>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Создать запрос" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("непустой список: CTA создания нет", () => {
    render(
      <AppRoot platform="base">
        <RideRequestsList onCreate={vi.fn()} />
      </AppRoot>,
    );

    expect(screen.queryByRole("button", { name: "Создать запрос" })).toBeNull();
  });
});

describe("RideRequestsList: тап по строке", () => {
  it("строки — прямые дети Section, без обёртки с двойным гуттером", () => {
    render(
      <AppRoot platform="base">
        <RideRequestsList onCreate={vi.fn()} />
      </AppRoot>,
    );

    const cell = screen.getByTestId(`ride-request-cell-${REQUEST_ID}`);
    const section = cell.closest("section");
    expect(section).toBeTruthy();
    expect(section?.querySelector("h2")?.textContent).toBe("Мои заявки");
    // section > outer div > body div > Cell. Лишняя обёртка (SectionBody или
    // бывший .requestsList) добавила бы ещё один уровень и второй паддинг.
    expect(cell.parentElement?.parentElement?.parentElement).toBe(section);
  });

  it("открывает шторку с управлением заявкой", async () => {
    render(
      <AppRoot platform="base">
        <RideRequestsList onCreate={vi.fn()} />
      </AppRoot>,
    );

    fireEvent.click(screen.getByTestId(`ride-request-cell-${REQUEST_ID}`));

    expect(
      await screen.findByRole("dialog", { name: "Запрос на попутку" }),
    ).toBeTruthy();
    expect(screen.getByText("Управление запросом")).toBeTruthy();
    expect(screen.getByRole("button", { name: "На паузу" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Редактировать" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Удалить запрос" })).toBeTruthy();
  });
});
