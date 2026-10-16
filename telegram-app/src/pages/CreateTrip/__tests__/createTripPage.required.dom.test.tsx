// @vitest-environment jsdom
// F17 + F18: обязательные поля формы создания поездки и лимит адресов.
//
// Проверяем ИТОГОВЫЙ DOM, а не пропсы компонента: китовские Input/Select
// спредят `restProps` через Text/Subheadline → Typography на нативный
// элемент, поэтому единственное честное доказательство — атрибуты на
// `<input>`/`<select>` в отрисованной форме. Проверка пропсов кита была бы
// проверкой нашего собственного компилятора.
//
// Обязательность берётся из контракта (packages/contracts/src/dto/trip.dto.ts:
// fromCityId/toCityId/departureAt/durationMinutes/distanceKm/price/
// seatsTotal). Адреса там `max(200)` без `.min(1)` — то есть НЕ обязательные,
// и тест отдельно следит, чтобы required на них не проскочил: лишняя
// «обязательность» враньёт скринридеру не меньше, чем её отсутствие.
//
// Авто-cleanup у RTL в этом репозитории не включён (нет setup-файла), поэтому
// `afterEach(cleanup)` объявлен явно — иначе второй `render` нашёл бы узлы
// первого.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * Контролы, обязательные по контракту: подпись поля → id в форме.
 * Порядок повторяет разметку страницы (маршрут, затем поездка).
 */
const REQUIRED_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["Город отправления", "create-from"],
  ["Город назначения", "create-to"],
  ["Дата и время", "create-date"],
  ["Цена, ₽", "create-price"],
  ["Места", "create-seats"],
  ["Расстояние, км", "create-distance"],
  ["В пути, часов", "create-duration"],
];

function renderForm(): void {
  render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/trips/my/new"]}>
        <CreateTripForm onCreated={() => {}} />
      </MemoryRouter>
    </AppRoot>,
  );
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

// jsdom не реализует scrollIntoView (как и window.scrollTo): CreateTripPage
// скроллит к ошибочному полю в эффекте, и TypeError из useEffect уронил бы
// рендер. Подменяем на весь файл — конвенция соседнего
// createTripPage.options.test.tsx:316.
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("CreateTripForm: обязательность по контракту (F17)", () => {
  it("каждое контрактно-обязательное поле помечено required в DOM", () => {
    renderForm();

    for (const [label, id] of REQUIRED_FIELDS) {
      const control = screen.getByLabelText(label) as HTMLInputElement;
      expect(control.id, `подпись «${label}» должна вести на свой контрол`).toBe(
        id,
      );
      // Именно DOM-свойство нативного элемента: до правки оно было false у
      // всех семи, и скринридер узнавал об обязательности только из алерта.
      expect(control.required, `«${label}» должен быть required`).toBe(true);
    }
  });

  it("required дублируется aria-required — его и читает скринридер", () => {
    renderForm();

    for (const [label] of REQUIRED_FIELDS) {
      expect(
        screen.getByLabelText(label).getAttribute("aria-required"),
        `«${label}» должен объявлять aria-required`,
      ).toBe("true");
    }
  });

  it("выбор города остаётся выпадающим списком по id, а не текстовым полем", () => {
    renderForm();

    for (const label of ["Город отправления", "Город назначения"]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      expect(select.tagName, `«${label}» — нативный <select>`).toBe("SELECT");
      // Свободный ввод по-прежнему невозможен (MEMORY.md §18): обязательность
      // не должна была открыть обход справочника. Сначала убеждаемся, что
      // контрол вообще найден — иначе проверка прошла бы вхолостую.
      const control = screen.queryByLabelText(label);
      expect(control, `«${label}» не найден`).not.toBeNull();
      expect(
        control?.closest("input"),
        `«${label}» не превратился в текстовый ввод`,
      ).toBeNull();
    }
  });

  it("необязательные по контракту поля НЕ помечены required", () => {
    renderForm();

    // fromAddress/toAddress в схеме `z.string().max(200)` — пустой адрес
    // валиден, а comment/tags/флаги помечены optional либо имеют дефолт.
    // required здесь был бы враньём, и тест ловит именно это.
    for (const label of ["Адрес отправления", "Адрес назначения", "Комментарий"]) {
      const control = screen.getByLabelText(label) as HTMLInputElement;
      expect(control.required, `«${label}» НЕ обязателен по контракту`).toBe(
        false,
      );
      expect(control.getAttribute("aria-required")).toBeNull();
    }
  });
});

describe("CreateTripForm: лимит длины адресов (F18)", () => {
  it("адреса ограничены 200 символами, комментарий — 500", () => {
    renderForm();

    // maxLength из контракта (fromAddress/toAddress: max(200)) вынесен в
    // поле, а не остаётся за алертом после отправки. Стиль тот же, что у
    // комментария (max(500)).
    expect(
      (screen.getByLabelText("Адрес отправления") as HTMLInputElement).maxLength,
    ).toBe(200);
    expect(
      (screen.getByLabelText("Адрес назначения") as HTMLInputElement).maxLength,
    ).toBe(200);
    expect(
      (screen.getByLabelText("Комментарий") as HTMLTextAreaElement).maxLength,
    ).toBe(500);
  });
});

describe("CreateTripForm: валидация не сломалась атрибутами", () => {
  it("незаполненные города дают прежнюю ошибку, привязанную к полю", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(mockMutate, "POST /trips не должен уходить с пустым маршрутом").not
      .toHaveBeenCalled();
    // Регресс на «required отменил валидацию»: нативной проверки в форме нет
    // (она не <form>), сообщение остаётся прежним.
    const message = screen.getByText("Выберите города из справочника");
    expect(message).toBeTruthy();
    // MEMORY.md §18: ошибка связана с полем через aria-describedby — required
    // не должен был порвать связку Field/FieldError.
    const from = screen.getByLabelText("Город отправления");
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(from.getAttribute("aria-describedby")).toBe(
      message.getAttribute("id"),
    );
  });

  it("пустое расстояние даёт прежний текст ошибки расстояния", () => {
    renderForm();

    // Дефолты формы (дата завтра, 500 ₽, 1 место, 1 час) валидны — падает
    // только расстояние, оставленное пустым.
    fireEvent.change(screen.getByLabelText("Город отправления"), {
      target: { value: CITY_FROM },
    });
    fireEvent.change(screen.getByLabelText("Город назначения"), {
      target: { value: CITY_TO },
    });
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(mockMutate).not.toHaveBeenCalled();
    const distance = screen.getByLabelText("Расстояние, км");
    const message = screen.getByText("Укажите расстояние — от 1 до 20000 км");
    expect(
      distance.getAttribute("aria-describedby"),
    ).toBe(message.getAttribute("id"));
  });

  it("заполненная форма по-прежнему уходит в POST /trips", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Город отправления"), {
      target: { value: CITY_FROM },
    });
    fireEvent.change(screen.getByLabelText("Город назначения"), {
      target: { value: CITY_TO },
    });
    fireEvent.change(screen.getByLabelText("Расстояние, км"), {
      target: { value: "180" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
