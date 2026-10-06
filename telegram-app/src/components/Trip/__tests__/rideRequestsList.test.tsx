// SSR-тесты списка своих заявок (тело страницы «История запросов»
// /profile/ride-requests). Паттерн notificationsModal.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library).
//
// Список вынесен из бывшей шторки «Ищу попутку» без изменений поведения:
// те же статусы, те же кнопки паузы/редактирования/отмены.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseRequests,
  mockUseUpdate,
  mockUseStatus,
  mockUseCancel,
} = vi.hoisted(() => ({
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
    useCreateRideRequestMutation: vi.fn(),
  };
});

import { RideRequestsList } from "@/components/Trip/RideRequestsList";

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

function mutationState(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
    ...overrides,
  };
}

function setMocks(requests: Record<string, unknown> = {}) {
  mockUseRequests.mockReturnValue(queryState(requests));
  mockUseUpdate.mockReturnValue(mutationState());
  mockUseStatus.mockReturnValue(mutationState());
  mockUseCancel.mockReturnValue(mutationState());
}

function renderList(): string {
  return renderToString(
    <AppRoot platform="base">
      <RideRequestsList />
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestsList: карточки и действия", () => {
  it("активный запрос: маршрут, бейдж «Активен», пауза/редактирование/отмена", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderList();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Активен");
    expect(html).toContain("Поставить на паузу");
    expect(html).toContain("Редактировать");
    expect(html).toContain("Отменить запрос");
  });

  it("приостановленный запрос: кнопка «Возобновить» вместо паузы", () => {
    setMocks({ data: [makeRequest({ status: "paused" })] });

    const html = renderList();

    expect(html).toContain("Возобновить");
    expect(html).not.toContain("Поставить на паузу");
  });

  it("завершённый запрос: без действий пауза/редактирование/отмена", () => {
    setMocks({ data: [makeRequest({ status: "fulfilled" })] });

    const html = renderList();

    expect(html).toContain("Москва → Тула");
    expect(html).not.toContain("Поставить на паузу");
    expect(html).not.toContain("Возобновить");
    expect(html).not.toContain("Редактировать");
    expect(html).not.toContain("Отменить запрос");
  });

  it("список не содержит формы создания: окно и страница разделены", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderList();

    expect(html).not.toContain("Новый запрос");
    expect(html).not.toContain("Опубликовать запрос");
  });
});

describe("RideRequestsList: состояния", () => {
  it("пустой список — пустое состояние", () => {
    setMocks({ data: [] });

    expect(renderList()).toContain("Активных запросов нет.");
  });

  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderList()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderList();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("тап-таргеты ≥44px", () => {
    setMocks({ data: [makeRequest()] });

    expect(renderList()).toContain('data-tap-target="44"');
  });
});