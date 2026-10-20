// SSR-тесты списка своих заявок (тело страницы «История запросов»
// /profile/ride-requests). Паттерн notificationsModal.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library).
//
// Список — только строки Cell: управление (пауза/редактирование/удаление)
// живёт в шторке RideRequestDetailsModal, поэтому в закрытом состоянии его
// кнопок в SSR-разметке быть не должно. Само содержимое шторки проверяет
// rideRequestDetails.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
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
  // Бесконечная лента: хук отдаёт { data: { pages: [...] }, ... }.
  // Хелпер принимает прежний массив items и оборачивает его в одну страницу.
  const { data, ...rest } = requests;
  const pageData =
    data === undefined
      ? undefined
      : {
          pages: [
            {
              items: data,
              pagination: {
                page: 1,
                limit: 20,
                total: Array.isArray(data) ? data.length : 0,
                totalPages: 1,
                hasMore: false,
              },
            },
          ],
        };
  mockUseRequests.mockReturnValue(
    queryState({
      data: pageData,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      ...rest,
    }),
  );
  mockUseUpdate.mockReturnValue(mutationState());
  mockUseStatus.mockReturnValue(mutationState());
  mockUseCancel.mockReturnValue(mutationState());
}

function renderList(): string {
  return renderToString(
    <AppRoot platform="base">
      <RideRequestsList onCreate={vi.fn()} />
    </AppRoot>,
  );
}

beforeEach(() => {
  setMocks({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestsList: строки Cell", () => {
  it("активный запрос: маршрут, статус, окно и места", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderList();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Активен");
    expect(html).toContain("2 января, 13:00 — 17:00");
    expect(html).toContain("2 места");
    expect(html).toContain(
      'data-testid="ride-request-cell-11111111-1111-4111-8111-111111111111"',
    );
    // Управление переехало в шторку — в списке его кнопок быть не должно.
    expect(html).not.toContain("На паузу");
    expect(html).not.toContain("Редактировать");
    expect(html).not.toContain("Удалить запрос");
  });

  it("приостановленный запрос: в строке «На паузе», без кнопки «Возобновить»", () => {
    setMocks({ data: [makeRequest({ status: "paused" })] });

    const html = renderList();

    expect(html).toContain("На паузе");
    expect(html).not.toContain("Возобновить");
  });

  it("завершённый запрос: статус виден, действий нет", () => {
    setMocks({ data: [makeRequest({ status: "fulfilled" })] });

    const html = renderList();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Выполнен");
    expect(html).not.toContain("На паузу");
    expect(html).not.toContain("Возобновить");
    expect(html).not.toContain("Редактировать");
    expect(html).not.toContain("Удалить запрос");
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

  it("строка — нативная кнопка с доступным именем", () => {
    setMocks({ data: [makeRequest()] });

    const html = renderList();

    expect(html).toContain("<button");
    expect(html).toContain("Открыть управление");
  });
});

// Регресс H3: статус `expired` не пишет никто, кроме сида. Просроченная
// заявка навсегда остаётся active/paused, но сервер возврат в active
// отклоняет (409 CONFLICT). Строка обязана честно сказать «Истёк», а
// шторка — не предлагать действия, которые сервер отклонит.
describe("RideRequestsList: просроченная заявка", () => {
  const expiredAt = "2020-01-01T00:00:00.000Z";

  it("у paused с истёкшим сроком — «Истёк», без «Возобновить»", () => {
    setMocks({
      data: [makeRequest({ status: "paused", expiresAt: expiredAt })],
    });
    const html = renderList();
    expect(html).toContain("Истёк");
    expect(html).not.toContain("На паузе");
    expect(html).not.toContain("Возобновить");
  });

  it("у active с истёкшим сроком нет паузы и правки", () => {
    setMocks({
      data: [makeRequest({ status: "active", expiresAt: expiredAt })],
    });
    const html = renderList();
    expect(html).toContain("Истёк");
    expect(html).not.toContain("На паузу");
    expect(html).not.toContain("Редактировать");
  });

  it("действующая paused-заявка остаётся «На паузе»", () => {
    setMocks({
      data: [
        makeRequest({
          status: "paused",
          expiresAt: "2030-01-02T10:00:00.000Z",
        }),
      ],
    });
    const html = renderList();
    expect(html).toContain("На паузе");
    expect(html).not.toContain("Истёк");
  });
});
