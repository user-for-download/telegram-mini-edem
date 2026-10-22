// @vitest-environment jsdom
// Предотправочная проверка Слоя 0: под маршрут и окно дат уже есть активные
// поездки — показываем ИНФОРМИРУЮЩИЙ диалог. Согласие = переход в карточку
// поездки и заявка НЕ создаётся; отказ, отсутствие совпадений и сетевой сбой
// = заявка создаётся ровно как до проверки (в т.ч. когда диалога нет вовсе).
//
// Отдельного бэкенд-эндпоинта нет: запрос идёт в тот же GET /trips, что и
// лента поиска, поэтому здесь мок именно tripsApi.getTrips.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Trip } from "@edem/contracts";

const {
  mockUseCities,
  mockMutate,
  mockToastShow,
  mockGetTrips,
  mockTgConfirm,
  mockNavigate,
} = vi.hoisted(() => ({
  mockUseCities: vi.fn(),
  // Мутация отдельным моком: useCreateRideRequestMutation — хук, он зовётся
  // на каждом рендере, и его счётчик.calls измерял бы рендеры, а не отправку.
  mockMutate: vi.fn(),
  mockToastShow: vi.fn(),
  mockGetTrips: vi.fn(),
  mockTgConfirm: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@/api/trips.api", () => ({
  tripsApi: { getTrips: mockGetTrips },
}));

vi.mock("@/helpers/tgConfirm", () => ({ tgConfirm: mockTgConfirm }));

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
import {
  buildMatchingTripsQuery,
  MATCHING_TRIPS_LIMIT,
  pickMatchingTrip,
} from "@/components/Trip/matchingTripsSearch";

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

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    fromCity: "Вологда",
    toCity: "Тула",
    durationMinutes: 300,
    distanceKm: 400,
    price: 800,
    seatsTotal: 3,
    seatsAvailable: 2,
    // Флаги опций поездки обязательны в ОТВЕТЕ (tripSchema): неизвестное
    // значение ≠ «выключено», поэтому у фикстуры нет «дефолта».

    autoComplete: false,
    matchingEnabled: true,

    driver: {
      id: "u-1",
      name: "Иван",
      avatar: "https://example.com/ivan.jpg",
      rating: 4.8,
      reviewsCount: 10,
      tripsCount: 12,
    },
    date: "2026-10-08",
    time: "08:00",
    tags: [],
    ...overrides,
  };
}

function tripsPage(items: Trip[], total = items.length) {
  return {
    items,
    pagination: {
      page: 1,
      limit: MATCHING_TRIPS_LIMIT,
      total,
      totalPages: 1,
      hasMore: false,
    },
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
  fireEvent.change(screen.getByLabelText("Откуда"), { target: { value: "c-1" } });
  fireEvent.change(screen.getByLabelText("Куда"), { target: { value: "c-2" } });
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
      <RideRequestCreateForm onNavigate={mockNavigate} />
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

describe("RideRequestCreateForm: предпроверка подходящих поездок", () => {
  it("есть совпадения + согласие: уходит в карточку, заявку не создаёт", async () => {
    mockGetTrips.mockResolvedValue(tripsPage([trip()]));
    mockTgConfirm.mockResolvedValue(true);

    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(mockTgConfirm).toHaveBeenCalledTimes(1));
    // Диалог информирует и называет маршрут — иначе непонятно, о чём он.
    const [message] = mockTgConfirm.mock.calls[0] ?? [];
    expect(String(message)).toContain("Вологда → Тула");
    // Переход в карточку наступает вместо публикации, а не после неё.
    expect(mockNavigate).toHaveBeenCalledWith("/trips/trip-1");
    await waitFor(() => expect(mockMutate).not.toHaveBeenCalled());
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("есть совпадения + отказ: публикует заявку, никуда не уходит", async () => {
    mockGetTrips.mockResolvedValue(tripsPage([trip()]));
    mockTgConfirm.mockResolvedValue(false);

    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("нет совпадений: публикует заявку без диалога", async () => {
    mockGetTrips.mockResolvedValue(tripsPage([]));

    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockTgConfirm).not.toHaveBeenCalled();
    // Проверка не обошлась: она идёт ДО публикации, иначе «уже есть
    // поездки» всплывало бы после создания заявки.
    expect(mockGetTrips).toHaveBeenCalledTimes(1);
  });

  it("сетевая ошибка проверки: публикует заявку без диалога", async () => {
    mockGetTrips.mockRejectedValue(new Error("offline"));

    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockTgConfirm).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("buildMatchingTripsQuery: маршрут и окно дат", () => {
  it("берёт города по id и окно календарными днями по Москве", () => {
    // Arrange
    const draft = {
      fromCityId: "c-1",
      toCityId: "c-2",
      earliest: "2026-10-08T08:00",
      latest: "2026-10-10T20:00",
    };

    // Act
    const filters = buildMatchingTripsQuery(draft);

    // Assert
    expect(filters).toEqual({
      fromCityId: "c-1",
      toCityId: "c-2",
      dateFrom: "2026-10-08",
      dateTo: "2026-10-10",
      page: 1,
      limit: MATCHING_TRIPS_LIMIT,
    });
  });

  it("нечем проверять — null: маршрут не выбран или даты не разобрались", () => {
    const base = {
      fromCityId: "c-1",
      toCityId: "c-2",
      earliest: "2026-10-08T08:00",
      latest: "2026-10-10T20:00",
    };

    expect(buildMatchingTripsQuery({ ...base, fromCityId: "" })).toBeNull();
    expect(buildMatchingTripsQuery({ ...base, latest: "" })).toBeNull();
  });
});

/** Водитель фикстуры trip(): меняем только id, чтобы «своя/чужая». */
const DRIVER = {
  id: "u-1",
  name: "Иван",
  avatar: "https://example.com/ivan.jpg",
  rating: 4.8,
  reviewsCount: 10,
  tripsCount: 12,
};

/** Окно заявки, достающее все фикстуры выше. */
const WINDOW = {
  fromCityId: "c-1",
  toCityId: "c-2",
  earliest: "2026-10-08T08:00",
  latest: "2026-10-10T20:00",
} as const;

describe("pickMatchingTrip: в какую поездку вести", () => {
  it("предпочитает поездку со свободными местами", () => {
    const items = [
      trip({ id: "full", seatsAvailable: 0 }),
      trip({ id: "free", seatsAvailable: 1 }),
    ];

    expect(pickMatchingTrip(items, WINDOW, "u-other")?.id).toBe("free");
  });

  it("пустой выдачи — null", () => {
    expect(pickMatchingTrip([], WINDOW, "u-other")).toBeNull();
  });
});

// Регресс H1: предпроверка предлагала поездки, на которые сервер заявку не
// подставил бы. GET /trips не исключает текущего пользователя, поэтому водитель
// уходил в СВОЮ карточку, а подбор выключенного водителя предлагался как
// «открыть поездку вместо запроса».
describe("pickMatchingTrip: предикат совпадает с серверным", () => {
  it("исключает СВОЮ поездку — сервер её заявке не подставит", () => {
    const own = trip({ id: "own", driver: { ...DRIVER, id: "u-me" } });
    expect(pickMatchingTrip([own], WINDOW, "u-me")).toBeNull();
  });

  it("свою поездку пропускает, чужие оставляет", () => {
    const own = trip({ id: "own", driver: { ...DRIVER, id: "u-me" } });
    const foreign = trip({ id: "foreign", driver: { ...DRIVER, id: "u-other" } });
    expect(pickMatchingTrip([own, foreign], WINDOW, "u-me")?.id).toBe("foreign");
  });

  it("исключает поездку с выключенным подбором", () => {
    const off = trip({ id: "off", matchingEnabled: false });
    expect(pickMatchingTrip([off], WINDOW, "u-other")).toBeNull();
  });

  it("исключает поездку, ушедшую ДО окна заявки", () => {
    // Отправление 2026-10-07T00:00Z, длительность 300 мин → рейс закончился
    // 2026-10-07T05:00Z. Окно открывается 2026-10-08T05:00Z (08:00 МСК):
    // пересечения нет.
    const early = trip({ id: "early", departureAt: "2026-10-07T00:00:00.000Z" });
    expect(pickMatchingTrip([early], WINDOW, "u-other")).toBeNull();
  });

  it("учитывает длительность: рейс, дотянувшийся до окна, остаётся кандидатом", () => {
    // Тот же отправной момент, но 12 часов в пути — до начала окна ещё едет.
    // Проверка по календарным дням (moscowDayKey) поймала бы это раньше;
    // сервер ловит по пересечению интервалов — должен и клиент.
    const longRide = trip({
      id: "long",
      departureAt: "2026-10-08T00:00:00.000Z",
      durationMinutes: 720,
    });
    expect(pickMatchingTrip([longRide], WINDOW, "u-other")?.id).toBe("long");
  });

  it("оставляет поездку, уходящую внутри окна", () => {
    const inside = trip({ id: "inside", departureAt: "2026-10-08T09:00:00.000Z" });
    expect(pickMatchingTrip([inside], WINDOW, "u-other")?.id).toBe("inside");
  });

  it("до загрузки профиля (userId пуст) чужие поездки не теряются", () => {
    const foreign = trip({ id: "foreign", driver: { ...DRIVER, id: "u-other" } });
    expect(pickMatchingTrip([foreign], WINDOW, null)?.id).toBe("foreign");
  });
});
