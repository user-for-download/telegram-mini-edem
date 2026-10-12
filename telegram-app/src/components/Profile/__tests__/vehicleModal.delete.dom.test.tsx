// @vitest-environment jsdom
// DOM-тест VehicleBody: нужен РЕРЕНДЕР, а не SSR. Дефект проявляется только
// при смене пропса на живом дереве — renderToString не «перерендеривает»
// компонент и его useState, поэтому парный SSR-файл (vehicleModal.test.tsx)
// этот класс регресса увидеть не может.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

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

import { VehicleBody } from "@/components/Profile/VehicleModal";

const CAR = { model: "Skoda Octavia", color: "белый", plate: "583" };

function queryState(vehicle: typeof CAR | null) {
  return {
    data: { car: vehicle },
    vehicle,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderBody() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/vehicle"]}>
        <VehicleBody onDone={() => {}} />
      </MemoryRouter>
    </AppRoot>,
  );
}

const field = (id: string): HTMLInputElement => {
  const node = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!node) throw new Error(`нет поля #${id}`);
  return node;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUpsert.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
  mockUseRemove.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  mockUseVehicle.mockReturnValue(queryState(CAR));
});

afterEach(() => cleanup());

/**
 * Регресс M2: удаление автомобиля оставляло форму с его данными.
 *
 * `useRemoveVehicleMutation` пишет пользователя БЕЗ машины в общий кэш
 * ["users","me"], `vehicle` становится null — но VehicleForm без `key`
 * не перемонтируется и продолжает держать удалённые значения. Дальше:
 *  - «Сохранить автомобиль» молча СОЗДАЁТ только что удалённую машину;
 *  - useClosingConfirmation сравнивает поля с пустым автомобилем → «Skoda
 *    Octavia" !== "" → true навсегда, и приложение уже не закрыть без
 *    ложного «отменить изменения?».
 */
describe("VehicleBody: удаление автомобиля очищает форму", () => {
  it("после удаления поля пусты, а не держат удалённый авто", () => {
    const { rerender } = renderBody();
    expect(field("vehicle-model").value).toBe("Skoda Octavia");
    expect(field("vehicle-color").value).toBe("белый");
    expect(field("vehicle-plate").value).toBe("583");

    // Мутация прошла: кэш отдал пользователя без машины.
    mockUseVehicle.mockReturnValue(queryState(null));
    rerender(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/vehicle"]}>
          <VehicleBody onDone={() => {}} />
        </MemoryRouter>
      </AppRoot>,
    );

    expect(field("vehicle-model").value).toBe("");
    expect(field("vehicle-color").value).toBe("");
    expect(field("vehicle-plate").value).toBe("");
  });

  it("после удаления пропадает и кнопка удаления", () => {
    const { rerender } = renderBody();
    expect(document.body.textContent).toContain("Удалить автомобиль");

    mockUseVehicle.mockReturnValue(queryState(null));
    rerender(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/vehicle"]}>
          <VehicleBody onDone={() => {}} />
        </MemoryRouter>
      </AppRoot>,
    );

    expect(document.body.textContent).not.toContain("Удалить автомобиль");
  });

  it("правки НЕ сбрасываются, пока автомобиль не удалён", () => {
    // key зависит от наличия авто, а не от его содержимого: перерисовка с
    // тем же автомобилем (например, рефетч профиля) правки терять не должна.
    const { rerender } = renderBody();
    // fireEvent.change, а не прямое присваивание .value: инпуты
    // контролируемые, React откатывает молчаливую запись в DOM.
    fireEvent.change(field("vehicle-model"), { target: { value: "Kia Rio" } });
    expect(field("vehicle-model").value).toBe("Kia Rio");
    rerender(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/vehicle"]}>
          <VehicleBody onDone={() => {}} />
        </MemoryRouter>
      </AppRoot>,
    );
    expect(field("vehicle-model").value).toBe("Kia Rio");
  });
});
