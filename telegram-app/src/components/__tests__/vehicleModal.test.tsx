// SSR-тесты тела VehicleModal (паттерн components/__tests__/modals.test.tsx:
// Modal — портал и в renderToString не попадает, тестируется VehicleBody).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicle.mockReturnValue(
    queryState({
      data: { car: { model: "Skoda Octavia", color: "белый", plate: "583" } },
      vehicle: { model: "Skoda Octavia", color: "белый", plate: "583" },
    }),
  );
  mockUseUpsert.mockReturnValue(mutation({ reset: vi.fn() }));
  mockUseRemove.mockReturnValue(
    mutation({ isError: false, error: null }),
  );
});

const { mockUseVehicle, mockUseUpsert, mockUseRemove } = vi.hoisted(() => ({
  mockUseVehicle: vi.fn(),
  mockUseUpsert: vi.fn(),
  mockUseRemove: vi.fn(),
}));

vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: mockUseVehicle,
  useUpsertVehicleMutation: mockUseUpsert,
  useRemoveVehicleMutation: mockUseRemove,
}));

import { VehicleBody } from "@/components/VehicleModal";

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    vehicle: null,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/vehicle"]}>{element}</MemoryRouter>
    </AppRoot>,
  );
}

describe("VehicleBody", () => {
  it("авто есть — карточка с моделью и кнопкой изменения", () => {
    const html = render(<VehicleBody />);
    expect(html).toContain("Skoda Octavia");
    expect(html).toContain("белый");
    expect(html).toContain("Изменить автомобиль");
    expect(html).toContain("Удалить автомобиль");
  });

  it("авто нет — empty-state с кнопкой добавления", () => {
    mockUseVehicle.mockReturnValue(
      queryState({ data: { car: null }, vehicle: null }),
    );
    const html = render(<VehicleBody />);
    expect(html).toContain("Автомобиль не добавлен");
    expect(html).toContain("Чтобы публиковать поездки, добавьте автомобиль");
    expect(html).toContain("Добавить автомобиль");
  });

  it("загрузка — плейсхолдер вместо карточки", () => {
    mockUseVehicle.mockReturnValue(
      queryState({ data: undefined, vehicle: null, isLoading: true }),
    );
    const html = render(<VehicleBody />);
    expect(html).toContain("Загрузка");
    expect(html).not.toContain("Изменить автомобиль");
  });

  it("удаление заблокировано 409 — объяснение про активные поездки", () => {
    mockUseRemove.mockReturnValue(
      mutation({
        isError: true,
        error: new ApiError(
          "Has active trips",
          "ACCOUNT_HAS_ACTIVE_OBLIGATIONS",
          409,
        ),
      }),
    );
    const html = render(<VehicleBody />);
    expect(html).toContain("завершите или отмените активные поездки");
  });

  it("бан mid-session — терминальный экран без формы", () => {
    mockUseVehicle.mockReturnValue(
      queryState({ error: new ApiError("Forbidden", "FORBIDDEN", 403) }),
    );
    const html = render(<VehicleBody />);
    expect(html).toContain("аккаунт заблокирован");
    expect(html).not.toContain("Изменить автомобиль");
  });
});
