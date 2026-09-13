// SSR-тесты RideRequestsBody (тело route-backed модалки /ride-requests).
// Modal — портал и в renderToString не попадает, поэтому тестируется
// экспортированное тело. Паттерн notificationsModal.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseRequests,
  mockUseCities,
  mockUseCreate,
  mockUseUpdate,
  mockUseStatus,
  mockUseCancel,
} = vi.hoisted(() => ({
  mockUseRequests: vi.fn(),
  mockUseCities: vi.fn(),
  mockUseCreate: vi.fn(),
  mockUseUpdate: vi.fn(),
  mockUseStatus: vi.fn(),
  mockUseCancel: vi.fn(),
}));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestsQuery: mockUseRequests,
  useCreateRideRequestMutation: mockUseCreate,
  useUpdateRideRequestMutation: mockUseUpdate,
  useRideRequestStatusMutation: mockUseStatus,
  useCancelRideRequestMutation: mockUseCancel,
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseCities,
}));

import { RideRequestsBody } from "@/components/RideRequestsModal";

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
  return { mutate: vi.fn(), isPending: false, error: null, variables: undefined, ...overrides };
}

function setMocks(requests: Record<string, unknown> = {}) {
  mockUseRequests.mockReturnValue(queryState(requests));
  mockUseCities.mockReturnValue(
    queryState({ data: [{ id: "c-1", name: "Москва" }, { id: "c-2", name: "Тула" }] }),
  );
  mockUseCreate.mockReturnValue(mutationState());
  mockUseUpdate.mockReturnValue(mutationState());
  mockUseStatus.mockReturnValue(mutationState());
  mockUseCancel.mockReturnValue(mutationState());
}

function renderBody(): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/ride-requests"]}>
        <RideRequestsBody />
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

describe("RideRequestsBody: форма и контракт", () => {
  it("форма создания: заголовок, поля, кнопка публикации", () => {
    const html = renderBody();

    expect(html).toContain("Новый запрос");
    expect(html).toContain('for="ride-from"');
    expect(html).toContain('for="ride-to"');
    expect(html).toContain('for="ride-earliest"');
    expect(html).toContain('for="ride-latest"');
    expect(html).toContain('for="ride-seats"');
    expect(html).toContain("Опубликовать запрос");
  });

  it("PageHeader внутрь модалки не рендерится (закрытие — header модалки)", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderBody();

    // PageHeader — header с Title level=1; в теле модалки его нет.
    expect(html).not.toContain("pt-5 pb-3");
  });
});

describe("RideRequestsBody: список", () => {
  it("активный запрос: маршрут, бейдж «Активен», пауза/редактирование/отмена", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderBody();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Активен");
    expect(html).toContain("Поставить на паузу");
    expect(html).toContain("Редактировать");
    expect(html).toContain("Отменить запрос");
  });

  it("приостановленный запрос: кнопка «Возобновить» вместо паузы", () => {
    setMocks({ data: [makeRequest({ status: "paused" })] });

    const html = renderBody();

    expect(html).toContain("Возобновить");
    expect(html).not.toContain("Поставить на паузу");
  });

  it("завершённый запрос: без действий пауза/редактирование/отмена", () => {
    setMocks({ data: [makeRequest({ status: "fulfilled" })] });

    const html = renderBody();

    expect(html).toContain("Москва → Тула");
    expect(html).not.toContain("Поставить на паузу");
    expect(html).not.toContain("Возобновить");
    expect(html).not.toContain("Редактировать");
    expect(html).not.toContain("Отменить запрос");
  });

  it("пустой список — пустое состояние", () => {
    setMocks({ data: [] });

    expect(renderBody()).toContain("Активных запросов нет.");
  });
});

describe("RideRequestsBody: a11y", () => {
  it("секция с именем, ошибки — role=alert, таргеты ≥44px", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderBody();

    expect(html).toContain('aria-label="Ищу попутку"');
    expect(html).toContain("min-h-[44px]");
  });

  it("ошибка создания рендерится с role=alert", () => {
    setMocks({ data: [] });
    mockUseCreate.mockReturnValue(mutationState({ error: new Error("boom") }));

    expect(renderBody()).toContain('role="alert"');
  });
});

describe("RideRequestsBody: состояния запроса", () => {
  it("loading — спиннер, ошибка — повтор", () => {
    setMocks({ isLoading: true });
    expect(renderBody()).toContain('aria-label="Загрузка"');

    setMocks({ isError: true, error: new Error("Нет соединения") });
    const html = renderBody();
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});
