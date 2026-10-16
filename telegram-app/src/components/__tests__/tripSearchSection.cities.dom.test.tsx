// @vitest-environment jsdom
//
// F5: сетевая ошибка справочника городов — это НЕ ошибка валидации.
//
// Раньше `cities.data` уходил в `CitySelectField`/`buildRideRequestDraft`
// без веток isLoading/isError. При сбое сети справочник = `undefined`,
// и человек видел «Выберите города из справочника» — собственную ошибку
// валидации (MEMORY.md:487), а в поиске на главной — молчаливый поиск без
// фильтра и два пустых селекта. Тест пинет инверсию: при ошибке справочника
// на экране «Повторить» и НЕТ текста «Выберите города из справочника».
//
// Оба потребителя справочника (карточка поиска и форма заявки) проверяются
// одним файлом: правило одно (CreateTripPage делает то же), а разъезжаться
// они не должны — раньше расходились именно из-за отсутствия гейта.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseCities, mockMutate, mockToastShow } = vi.hoisted(() => ({
  mockUseCities: vi.fn(),
  mockMutate: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseCities,
}));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useCreateRideRequestMutation: () => ({
      mutate: mockMutate,
      isPending: false,
      error: null,
    }),
    useRideRequestsQuery: vi.fn(),
    useUpdateRideRequestMutation: vi.fn(),
    useRideRequestStatusMutation: vi.fn(),
    useCancelRideRequestMutation: vi.fn(),
  };
});

vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { TripSearchSection } from "@/components/Section/TripSearchSection";
import { RideRequestCreateForm } from "@/components/Trip/RideRequestCreateForm";

/** Текст ошибки валидации, который справочник НЕ должен подменять. */
const VALIDATION_MESSAGE = "Выберите города из справочника";

const CITIES = [
  { id: "c-1", name: "Вологда" },
  { id: "c-2", name: "Тула" },
];

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
    ...overrides,
  };
}

const errored = () =>
  queryState({
    isError: true,
    error: new Error("Сеть недоступна"),
  });
const pending = () => queryState({ isLoading: true });
const loaded = () => queryState({ data: CITIES });

function renderSearch(): void {
  render(
    <AppRoot platform="base">
      <TripSearchSection onSearch={vi.fn()} />
    </AppRoot>,
  );
}

function renderForm(): void {
  render(
    <AppRoot platform="base">
      <RideRequestCreateForm />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseCities.mockReturnValue(loaded());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Справочник городов: ошибка сети — терминальный экран, а не валидация", () => {
  it("TripSearchSection: при ошибке справочника — «Повторить», полей нет", () => {
    mockUseCities.mockReturnValue(errored());

    renderSearch();

    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    // Селектов нет вовсе: пустые дропдауны выглядели бы как «городов нет».
    expect(screen.queryByLabelText("Откуда")).toBeNull();
    expect(screen.queryByLabelText("Куда")).toBeNull();
    // Поиск без маршрута больше недостижим — неотфильтрованной выдачи не будет.
    expect(screen.queryByRole("button", { name: /Найти поездку/ })).toBeNull();
    expect(document.body.textContent).not.toContain(VALIDATION_MESSAGE);
  });

  it("TripSearchSection: пока справочник грузится — загрузка, а не пустые селекты", () => {
    mockUseCities.mockReturnValue(pending());

    renderSearch();

    // ui/Loading: один role=status с именем «Загрузка» (спиннер кита —
    // свой безымянный role=status, поэтому берём по имени).
    expect(screen.getByLabelText("Загрузка")).toBeTruthy();
    expect(screen.queryByLabelText("Откуда")).toBeNull();
    expect(screen.queryByRole("button", { name: /Найти поездку/ })).toBeNull();
    expect(document.body.textContent).not.toContain(VALIDATION_MESSAGE);
  });

  it("TripSearchSection: со справочником выбор остаётся по id", () => {
    renderSearch();

    const from = screen.getByLabelText("Откуда") as HTMLSelectElement;
    // Нативный <select> CitySelectField — единственный способ выбрать город:
    // свободный ввод имени невозможен ПО УМОЛЧАНИЮ (MEMORY.md:495).
    expect(from.tagName).toBe("SELECT");
    expect(
      Array.from(from.options)
        .map((option) => option.value)
        .filter(Boolean),
    ).toEqual(["c-1", "c-2"]);
  });

  it("форма заявки: при ошибке справочника — «Повторить» и НЕТ текста валидации", () => {
    mockUseCities.mockReturnValue(errored());

    renderForm();

    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    // Ключевая инверсия: раньше этот путь упирался в submit →
    // buildRideRequestDraft(values, undefined) → «Выберите города из справочника».
    expect(document.body.textContent).not.toContain(VALIDATION_MESSAGE);
    // Кнопки публикации нет — до валидации форма не доходит.
    expect(
      screen.queryByRole("button", { name: "Опубликовать запрос" }),
    ).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("форма заявки: повтор из терминального экрана зовёт refetch справочника", () => {
    const refetch = vi.fn();
    mockUseCities.mockReturnValue(
      queryState({
        isError: true,
        error: new Error("Сеть недоступна"),
        refetch,
      }),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("форма заявки: пока справочник грузится — загрузка без текста валидации", () => {
    mockUseCities.mockReturnValue(pending());

    renderForm();

    expect(screen.getByLabelText("Загрузка")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Опубликовать запрос" }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(VALIDATION_MESSAGE);
  });

  // Страховка от перелечения: настоящая ошибка валидации («справочник есть,
  // город не выбран») обязана остаться на месте — её удаление сделало бы
  // форму «прощающей» забытый маршрут.
  it("форма заявки: справочник есть, город не выбран — ошибка валидации остаётся", () => {
    renderForm();

    fireEvent.click(
      screen.getByRole("button", { name: "Опубликовать запрос" }),
    );

    expect(screen.getByText(VALIDATION_MESSAGE)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
