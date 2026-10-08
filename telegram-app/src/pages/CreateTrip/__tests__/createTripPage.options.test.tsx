// @vitest-environment jsdom
// Секция «Опции поездки» в форме создания поездки.
//
// Проверяем DOM, а не исходник: порядок секции, роль переключателя и то, что
// `onChange` доходит до формы — свойства разметки и поведения, а текст
// правки их не ломает. Файл в jsdom, а не SSR (как `ui/__tests__/
// switchRow.test.tsx`): нужно кликнуть по переключателю и поймать `mutate`.
//
// Авто-cleanup у RTL в этом репозитории не включён (нет setup-файла), поэтому
// `afterEach(cleanup)` объявлен явно — иначе второй `render` в тесте нашёл бы
// узлы первого и «нашлось несколько элементов» вместо проверки инварианта.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

// Telegram-клиента в тесте нет: хаптика и подтверждение закрытия обязаны быть
// no-op (в проде они уже обёрнуты в ifAvailable).
vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
  closingBehavior: {
    enableConfirmation: { ifAvailable: vi.fn() },
    disableConfirmation: { ifAvailable: vi.fn() },
  },
}));

const { mockUseCities, mockUseVehicle, mockMutate } = vi.hoisted(() => ({
  mockUseCities: vi.fn(),
  mockUseVehicle: vi.fn(),
  // Мутация отдельным моком: useCreateTripMutation — хук, он зовётся на каждом
  // рендере, и его calls.calls измеряли бы рендеры, а не отправку.
  mockMutate: vi.fn(),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseCities,
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useCreateTripMutation: () => ({
      mutate: mockMutate,
      isPending: false,
      error: null,
    }),
  };
});

// Автомобиль есть — иначе страница уходит в гейт «нужен автомобиль», а не в
// форму. Мок всего модуля (а не useVehicleQuery) отсекает ветку VehicleModal →
// ProfilePage, которой в этом тесте делать нечего.
vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: mockUseVehicle,
  useUpsertVehicleMutation: vi.fn(),
  useRemoveVehicleMutation: vi.fn(),
}));

vi.mock("@/components/Profile/VehicleModal", () => ({
  VehicleModal: () => null,
}));

vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: vi.fn() }) };
});

import { CreateTripForm } from "@/pages/CreateTrip/CreateTripPage";

// id справочника обязан быть uuid — иначе createTripDtoSchema отвергнет черновик
// и submit молча ушёл бы в ошибку валидации вместо отправки.
const CITY_FROM = "11111111-1111-4111-8111-111111111111";
const CITY_TO = "22222222-2222-4222-8222-222222222222";
const CITIES = [
  { id: CITY_FROM, name: "Вологда" },
  { id: CITY_TO, name: "Череповец" },
];

/** Имена переключателей = `label` фасадной строки (ui/SwitchRow). */
const AUTO_COMPLETE = "Завершать поездку сразу";
const MATCHING = "Предлагать поездку подходящим попутчикам";

function renderForm(): void {
  render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/trips/my/new"]}>
        <CreateTripForm onCreated={() => {}} />
      </MemoryRouter>
    </AppRoot>,
  );
}

/**
 * Минимально валидный черновик: города из справочника и расстояние. Остальное
 * (дата завтра, 500 ₽, 1 место, 1 час) — дефолты формы.
 */
function fillValidDraft(): void {
  fireEvent.change(screen.getByLabelText("Город отправления"), {
    target: { value: CITY_FROM },
  });
  fireEvent.change(screen.getByLabelText("Город назначения"), {
    target: { value: CITY_TO },
  });
  fireEvent.change(screen.getByLabelText("Расстояние, км"), {
    target: { value: "180" },
  });
}

/** Первый аргумент `mutate` — DTO поездки. */
function submittedDto(): Record<string, unknown> {
  expect(mockMutate, "POST /trips не ушёл").toHaveBeenCalledTimes(1);
  const [dto] = mockMutate.mock.calls[0] as [Record<string, unknown>, unknown];
  return dto;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCities.mockReturnValue({
    data: CITIES,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseVehicle.mockReturnValue({
    data: { car: { model: "Lada Vesta", color: "Белый" } },
    vehicle: { model: "Lada Vesta", color: "Белый" },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(cleanup);

describe("CreateTripForm: секция «Опции поездки»", () => {
  it("обе строки находятся по роли switch с осмысленными именами", () => {
    renderForm();

    // Роль, а не класс кита: именно её слышит скринридер («включено/выключено»).
    // Имя = label фасадной строки — по title искать нельзя, оно может отличаться.
    expect(screen.getByRole("switch", { name: AUTO_COMPLETE })).toBeTruthy();
    expect(screen.getByRole("switch", { name: MATCHING })).toBeTruthy();
    // Ровно две: лишний switch в форме означал бы опцию без внятного названия.
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("строки опций БЕЗ иконок — решение владельца", () => {
    // Владелец убрал иконки у опций: у полей формы они уже есть, а лишние
    // пиктограммы в опциях только шумят. Без этого пина иконка вернётся молча
    // при следующем добавлении строки.
    //
    // Проверка по содержимому СТРОКИ, а не «svg нет на странице»: у полей
    // формы (длительность, дата) пиктограммы остались, и глобальная проверка
    // была бы враньём.
    //
    // Именно svg, потому что иконки проекта — lucide-react (рисует svg). Проверено
    // откатом: с иконкой в слоте тест краснеет.
    renderForm();

    for (const name of [AUTO_COMPLETE, MATCHING]) {
      const switchNode = screen.getByRole("switch", { name });
      const row = switchNode.closest("[class]");
      expect(row, `строка «${name}» должна существовать`).toBeTruthy();
      expect(
        row?.querySelector("svg, img"),
        `в строке «${name}» не должно быть иконки`,
      ).toBeNull();
    }
  });

  it("aria-checked не проставлен руками — состояние выводит сам браузер", () => {
    renderForm();

    // Регресс на дублирование: aria-checked на узле разошёлся бы с checked
    // (его ставит SwitchRow, а не форма), и скринридер озвучил бы чужое.
    for (const name of [AUTO_COMPLETE, MATCHING]) {
      expect(
        screen.getByRole("switch", { name }).getAttribute("aria-checked"),
        name,
      ).toBeNull();
    }
  });

  it("подписи объясняют срок и последствие выключенного подбора", () => {
    renderForm();

    // Ровно то, ради чего строки и затевались: без срока и последствий
    // переключатель читается как «Автозавершение: вкл/выкл» и ни о чём не говорит.
    expect(
      screen.getByText(
        "Завершится через сутки после отправления — или раньше, вручную",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Предложим тем, кто ищет попутку по вашему маршруту"),
    ).toBeTruthy();
  });

  it("секция стоит после «Условий поездки» и до кнопки «Опубликовать»", () => {
    renderForm();

    const options = screen.getByRole("heading", { name: "Опции поездки" });
    const conditions = screen.getByRole("heading", { name: "Условия поездки" });
    const submit = screen.getByRole("button", { name: "Опубликовать" });

    // Решение владельца: опции — последнее, что читают перед отправкой.
    // compareDocumentPosition(a) & FOLLOWING означает «b идёт ПОСЛЕ a»,
    // поэтому сравниваем всегда от того узла, который должен идти раньше.
    expect(
      conditions.compareDocumentPosition(options) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      "«Условия поездки» должны идти перед секцией опций",
    ).toBeTruthy();
    expect(
      options.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
      "кнопка «Опубликовать» должна идти после секции опций",
    ).toBeTruthy();
  });
});

describe("CreateTripForm: переключение опций", () => {
  it("клик по строке меняет значение, которое уходит в POST /trips", () => {
    renderForm();
    fillValidDraft();

    // Дефолты = текущее поведение бэкенда: autoComplete=false, matchingEnabled=true.
    fireEvent.click(screen.getByRole("switch", { name: AUTO_COMPLETE }));
    fireEvent.click(screen.getByRole("switch", { name: MATCHING }));
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(submittedDto()).toMatchObject({
      autoComplete: true,
      matchingEnabled: false,
    });
  });

  it("подпись строки пересказывает состояние после переключения", () => {
    renderForm();

    fireEvent.click(screen.getByRole("switch", { name: AUTO_COMPLETE }));
    fireEvent.click(screen.getByRole("switch", { name: MATCHING }));

    // Подпись — не «вкл/выкл», а объяснение: водитель должен видеть, что именно
    // изменится, не открывая настройки.
    expect(screen.getByText(/Завершится после конца рейса/)).toBeTruthy();
    expect(screen.getByText(/Не предложим никому/)).toBeTruthy();
  });

  it("без переключений уходит дефолт (текущее поведение)", () => {
    renderForm();
    fillValidDraft();

    // Страховка от «опция тихо уехала в false»: без кликов форма обязана
    // отправить ровно то, что отправляла до появления секции.
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(submittedDto()).toMatchObject({
      autoComplete: false,
      matchingEnabled: true,
    });
  });
});
