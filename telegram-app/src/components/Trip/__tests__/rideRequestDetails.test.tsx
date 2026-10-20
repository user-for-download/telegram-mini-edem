// SSR-тесты тела шторки управления заявкой (`RideRequestDetailsBody`).
//
// Тело экспортируется отдельно от `RideRequestDetailsModal` намеренно: Modal
// кита — портал, в renderToString не попадает (приём ReportDetailsBody).
//
// Проверяем то, ради чего строку списка сделали кнопкой: в шторке видны
// маршрут/статус/окно и доступны управление, правка и удаление. У
// терминальных заявок действий нет.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { RideRequest } from "@edem/contracts";

const { mockUseUpdate, mockUseStatus, mockUseCancel } = vi.hoisted(() => ({
  mockUseUpdate: vi.fn(),
  mockUseStatus: vi.fn(),
  mockUseCancel: vi.fn(),
}));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useUpdateRideRequestMutation: mockUseUpdate,
    useRideRequestStatusMutation: mockUseStatus,
    useCancelRideRequestMutation: mockUseCancel,
  };
});

import { RideRequestDetailsBody } from "@/components/Trip/RideRequestDetailsModal";

function mutationState(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<RideRequest> = {}): RideRequest {
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

function renderBody(request: RideRequest = makeRequest()): string {
  return renderToString(
    <AppRoot platform="base">
      <RideRequestDetailsBody request={request} onClose={() => {}} />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseUpdate.mockReturnValue(mutationState());
  mockUseStatus.mockReturnValue(mutationState());
  mockUseCancel.mockReturnValue(mutationState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestDetailsBody: содержимое шторки", () => {
  it("маршрут, статус, окно и места", () => {
    const html = renderBody();

    expect(html).toContain("Москва → Тула");
    expect(html).toContain("Активен");
    expect(html).toContain("2 января, 13:00 — 17:00");
    expect(html).toContain("2 места");
    expect(html).toContain("действует до 2 января, 13:00");
  });

  it("у активной заявки — пауза, правка и удаление", () => {
    const html = renderBody();

    expect(html).toContain("Управление запросом");
    expect(html).toContain("На паузу");
    expect(html).toContain("Редактировать");
    expect(html).toContain("Удалить запрос");
  });

  it("у приостановленной — «Возобновить» вместо паузы", () => {
    const html = renderBody(makeRequest({ status: "paused" }));

    expect(html).toContain("На паузе");
    expect(html).toContain("Возобновить");
    expect(html).not.toContain("На паузу");
  });

  it("у завершённой — только статус, без управления", () => {
    const html = renderBody(makeRequest({ status: "fulfilled" }));

    expect(html).toContain("Выполнен");
    expect(html).not.toContain("Управление запросом");
    expect(html).not.toContain("На паузу");
    expect(html).not.toContain("Редактировать");
    expect(html).not.toContain("Удалить запрос");
  });

  it("у просроченной — «Истёк» и подсказка, без управления", () => {
    const html = renderBody(
      makeRequest({
        status: "active",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );

    expect(html).toContain("Истёк");
    expect(html).toContain("Срок действия истёк");
    expect(html).not.toContain("Управление запросом");
    expect(html).not.toContain("На паузу");
    expect(html).not.toContain("Редактировать");
  });

  it("терминальный статус не подменяется на «Истёк» после срока", () => {
    const html = renderBody(
      makeRequest({
        status: "cancelled",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );

    expect(html).toContain("Отменён");
    expect(html).not.toContain("Истёк");
  });
});
