// @vitest-environment jsdom
// Публикация заявки: тело запроса уходит в create-мутацию, а пользователь
// получает тост «Запрос опубликован» с маршрутом.
//
// Тост здесь — единственный видимый feedback: окно остаётся открытым, поля
// очищаются, а хаптика на iOS в WebView может не сработать. Регресс на
// возврат к «пустая форма = успех».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseCities, mockMutate, mockToastShow } = vi.hoisted(() => ({
  mockUseCities: vi.fn(),
  // Мутация отдельным моком: useCreateRideRequestMutation — хук, он зовётся
  // на каждом рендере, и его счётчик.calls измерял бы рендеры, а не отправку.
  mockMutate: vi.fn(),
  mockToastShow: vi.fn(),
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

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseCities,
}));

vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { RideRequestCreateForm } from "@/components/Trip/RideRequestCreateForm";

const CITIES = [
  { id: "c-1", name: "Вологда" },
  { id: "c-2", name: "Тула" },
];

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

/** Значение datetime-local в будущем: «YYYY-MM-DDTHH:mm» (локальное). */
function localDateTime(daysAhead: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText("Откуда"), {
    target: { value: "c-1" },
  });
  fireEvent.change(screen.getByLabelText("Куда"), {
    target: { value: "c-2" },
  });
  fireEvent.change(screen.getByLabelText("Не раньше"), {
    target: { value: localDateTime(1, 8) },
  });
  fireEvent.change(screen.getByLabelText("Не позже"), {
    target: { value: localDateTime(1, 20) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Опубликовать запрос" }));
}

function renderForm(): void {
  render(
    <AppRoot platform="base">
      <RideRequestCreateForm />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseCities.mockReturnValue(queryState({ data: CITIES }));
  // Мутация сразу зовёт onSuccess — как успешный ответ сервера.
  mockMutate.mockImplementation(
    (_data: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RideRequestCreateForm: публикация", () => {
  // Публикация стала асинхронной: перед мутацией форма спрашивает, нет ли
  // уже подходящих поездок (GET /trips). Здесь ответа нет — реальный
  // tripsApi.getTrips в jsdom падает, и проверка пропускается как «совпадений
  // неизвестно», поэтому путь «как раньше» и проверяется. Ждём мутацию через
  // waitFor: синхронного клика больше недостаточно.
  it("уходит запрос с маршрутом, окном и сроком", async () => {
    renderForm();

    fillAndSubmit();

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const [dto] = mockMutate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(dto).toMatchObject({
      fromCityId: "c-1",
      toCityId: "c-2",
      seats: 1,
    });
    // Срок действия = конец окна «Не позже»: привязка к «не раньше» гасила
    // заявку в момент начала окна.
    expect(dto.expiresAt).toBe(dto.latestAt);
  });

  it("показывает тост с маршрутом и очищает поля", async () => {
    renderForm();

    fillAndSubmit();

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledTimes(1));
    expect(mockToastShow).toHaveBeenCalledWith({
      text: "Запрос опубликован",
      description: "Вологда → Тула — водители увидят его в поиске",
    });
    // Форма готова к следующей заявке: окно не закрываем (сценарий
    // «нужно попутчика в три города»), но поля очищены.
    expect((screen.getByLabelText("Куда") as HTMLSelectElement).value).toBe("");
    expect(
      (screen.getByLabelText("Не раньше") as HTMLInputElement).value,
    ).toBe("");
  });

  it("не публикует и не показывает тост при незаполненном маршруте", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Опубликовать запрос" }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
    expect(screen.getByText("Выберите города из справочника")).toBeTruthy();
  });

  it("двойной тап не создаёт вторую заявку (гейт на время предпроверки)", async () => {
    renderForm();

    const button = screen.getByRole("button", {
      name: "Опубликовать запрос",
    });
    fireEvent.change(screen.getByLabelText("Откуда"), {
      target: { value: "c-1" },
    });
    fireEvent.change(screen.getByLabelText("Куда"), {
      target: { value: "c-2" },
    });
    fireEvent.change(screen.getByLabelText("Не раньше"), {
      target: { value: localDateTime(1, 8) },
    });
    fireEvent.change(screen.getByLabelText("Не позже"), {
      target: { value: localDateTime(1, 20) },
    });

    // Пока первая предпроверка (GET /trips) в полёте, кнопка не pending —
    // без синхронного гейта второй тап ушёл бы второй мутацией.
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
