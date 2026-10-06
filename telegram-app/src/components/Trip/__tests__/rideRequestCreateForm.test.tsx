// SSR-тесты формы создания заявки (содержимое всплывающего окна
// RideRequestCreateModal). Modal — портал и в renderToString не попадает,
// поэтому тестируется тело. Паттерн notificationsModal.test.tsx (SSR, моки
// хуков через vi.hoisted, без testing-library).
//
// Форма вынесена из бывшей шторки «Ищу попутку» без изменений полей и id:
// на `ride-*` завязана валидация (rideRequestValidation) и e2e.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseCities, mockUseCreate } = vi.hoisted(() => ({
  mockUseCities: vi.fn(),
  mockUseCreate: vi.fn(),
}));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useCreateRideRequestMutation: mockUseCreate,
    useRideRequestsQuery: vi.fn(),
    useUpdateRideRequestMutation: vi.fn(),
    useRideRequestStatusMutation: vi.fn(),
    useCancelRideRequestMutation: vi.fn(),
  };
});

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseCities,
}));

import { RideRequestCreateForm } from "@/components/Trip/RideRequestCreateForm";

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
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function renderForm(): string {
  return renderToString(
    <AppRoot platform="base">
      <RideRequestCreateForm />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseCities.mockReturnValue(
    queryState({
      data: [
        { id: "c-1", name: "Москва" },
        { id: "c-2", name: "Тула" },
      ],
    }),
  );
  mockUseCreate.mockReturnValue(mutationState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestCreateForm: контракт формы", () => {
  it("заголовок, поля и кнопка публикации", () => {
    const html = renderForm();

    expect(html).toContain("Новый запрос");
    expect(html).toContain('for="ride-from"');
    expect(html).toContain('for="ride-to"');
    expect(html).toContain('for="ride-earliest"');
    expect(html).toContain('for="ride-latest"');
    expect(html).toContain('for="ride-seats"');
    expect(html).toContain("Опубликовать запрос");
  });

  it("форма не содержит списка заявок: он на отдельной странице", () => {
    // Разделение ответственности: окно — только создание. Появление
    // «Поставить на паузу» здесь означало бы, что список снова слипся с формой.
    expect(renderForm()).not.toContain("Поставить на паузу");
  });

  it("тап-таргеты ≥44px и ошибка создания с role=alert", () => {
    expect(renderForm()).toContain('data-tap-target="44"');

    mockUseCreate.mockReturnValue(mutationState({ error: new Error("boom") }));
    expect(renderForm()).toContain('role="alert"');
  });
});