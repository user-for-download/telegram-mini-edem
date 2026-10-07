// Рендер-тесты главной: профиль-бар с рейтингом, сводка-счётчики
// (InlineButtons + Badge), экспресс-поиск (нативные Select-дропдауны),
// CTA водителю (Placeholder), популярные направления. Паттерн
// tripsPages.test.tsx (SSR, без testing-library).
// Данные — только через замокированные queries (profile/bookings),
// моковых сущностей и mockData в коде страницы нет.
// Тест рядом с папкой страницы (миграция папка/компонент, B1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ToastProvider } from "@/components/Toast/ToastProvider";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseMyTrips.mockReturnValue(queryState({ data: undefined }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue({ mutate: vi.fn() });
  mockUseVehicle.mockReturnValue(queryState({ vehicle: { model: "Skoda", color: "белый" } }));
  mockUseFeed.mockReturnValue(queryState({ data: [] }));
});

const {
  mockUseFeed,
  mockUseProfile,
  mockUseMyBookings,
  mockUseAllCities,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
  mockUseMyTrips,
  mockUseVehicle,
} = vi.hoisted(() => ({
  mockUseFeed: vi.fn(),
  mockUseProfile: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
  mockUseMyTrips: vi.fn(),
  mockUseVehicle: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: mockUseMyTrips,
}));

vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: mockUseVehicle,
}));
// Лента заявок попутчиков на главной — мок: главной нужен предсказуемый
// список, а реальный запрос уехал бы в сеть из SSR-теста.
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestFeedQuery: mockUseFeed,
}));

import { HomePage } from "@/pages/HomePage/HomePage";

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

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>{element}</MemoryRouter>
      </ToastProvider>
    </AppRoot>,
  );
}

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    price: 450,
    seatsTotal: 4,
    seatsAvailable: 2,
    driver: { name: "Александр" },
    ...overrides,
  };
}

describe("HomePage", () => {
  it("показывает экспресс-поиск, направления и преимущества", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: { name: "Александр", avatar: "https://t.me/a.png", rating: 4.8 },
      }),
    );
    const html = render(<HomePage />);
    // Профиль-бар с реальным именем и рейтингом из query.
    expect(html).toContain("Александр");
    expect(html).toContain("4.8");
    // Экспресс-поиск — карточка без заголовка.
    expect(html).toContain("Найти поездку");
    // CTA водителю.
    expect(html).toContain("Едете на машине?");
    expect(html).toContain("Создать поездку");
    // CTA пассажиру — отдельным блоком, не второй кнопкой в водительском:
    // «Едете на машине?» пассажиру не подходит.
    expect(html).toContain("Нужна попутка?");
    expect(html).toContain("Ищу попутку");
    // Лента заявок попутчиков: при пустой ленте секция прячется, поэтому
    // заголовка нет — вместо статичных направлений на главной тишина.
    expect(html).not.toContain("Кто ищет попутку");
    // Без данных — все три плашки с нулями.
    expect(html).toContain("Поездки");
    expect(html).toContain("Брони");
    expect(html).toContain("Заявки");
    expect(html).toContain("активных: 0");
  });

  it("сводка: активные поездки за рулём — кнопка «Поездки» (total, не длина страниц)", () => {
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              // Один item при total 25: счётчик обязан показать total,
              // а не длину загруженной страницы (P0: ownTrips.length врал).
              items: [
                makeTrip({
                  id: "t-own",
                  departureAt: new Date(Date.now() + 3_600_000).toISOString(),
                }),
              ],
              pagination: { total: 25, hasMore: true },
            },
          ],
        },
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Поездки");
    expect(html).toContain("активных: 25");
    // Остальные плашки на месте с нулями.
    expect(html).toContain("Брони");
    expect(html).toContain("Заявки");
  });

  it("сводка: брони — кнопка с разбивкой в aria-label", () => {
    mockUseMyBookings.mockReturnValue(
      queryState({
        data: [
          { id: "b-1", seat: 1, status: "confirmed", trip: makeTrip() },
          {
            id: "b-2",
            seat: 2,
            status: "pending",
            trip: makeTrip({ id: "t-2", toCity: "Сокол" }),
          },
        ],
      }),
    );
    const html = render(<HomePage />);
    // Есть заявка — кнопка «Ожидают», разбивка в aria-label.
    expect(html).toContain("Ожидают");
    expect(html).toContain("подтверждено: 1, ожидает: 1");
    expect(html).toContain("активных: 0");
  });

  it("сводка: заявки пассажиров — кнопка всегда, бейдж по count", () => {
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest()] }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Заявки");
    expect(html).toContain("новых: 1");
    expect(html).toContain("Поездки");
    expect(html).toContain("Брони");
  });

  it("сводка: бейдж заявок — сумма pendingRequestsCount, а не длина списка", () => {
    // /bookings/driver отдаёт take 50 строк-заявок: requests.length при
    // нескольких заявках на поездку показывал бы число поездок вместо
    // числа заявок. Точный счётчик — сумма серверных pendingRequestsCount
    // по активным поездкам.
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [
                makeTrip({ id: "t-1", pendingRequestsCount: 30 }),
                makeTrip({ id: "t-2", pendingRequestsCount: 25 }),
              ],
              pagination: { total: 2, hasMore: false },
            },
          ],
        },
      }),
    );
    // Строк в выдаче меньше 50 — как у бэкенда при обрезке.
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: Array.from({ length: 12 }, () => makeDriverRequest()) }),
    );

    const html = render(<HomePage />);

    expect(html).toContain("новых: 55");
    expect(html).not.toContain("новых: 12");
  });

  it("сводка: без pendingRequestsCount — откат на оценку по списку", () => {
    // pendingRequestsCount опционален в контракте: при ответе без него
    // показываем прежнюю оценку по строкам, а не ноль.
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [
            {
              items: [makeTrip({ id: "t-1" }), makeTrip({ id: "t-2" })],
              pagination: { total: 2, hasMore: false },
            },
          ],
        },
      }),
    );
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest(), makeDriverRequest()] }),
    );

    const html = render(<HomePage />);

    expect(html).toContain("новых: 2");
  });

  it("сводка: три плашки с aria-label целей (сегменты driving/bookings/requests)", () => {
    // InlineButtons едет через onClick → navigate: URL в SSR-строке нет,
    // поэтому проверяем различимые aria-label трёх кнопок, а сами URL —
    // юнит-тестом навигации ниже (клик → navigate c нужным сегментом).
    const html = render(<HomePage />);
    expect(html).toContain("Ваши поездки, активных:");
    expect(html).toContain("Ваши брони, подтверждено:");
    expect(html).toContain("Заявки пассажиров, новых:");
  });

  it("ошибка сводки — один Notice с «Повторить», а не нули", () => {
    // queryState по умолчанию isError:false — ошибку задаём парой
    // error + isError, как в реальных useQuery при падении запроса.
    mockUseMyBookings.mockReturnValue(
      queryState({ error: new Error("network down"), isError: true }),
    );
    const html = render(<HomePage />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Повторить");
    expect(html).not.toContain("активных: 0");
  });

  it("сводка при загрузке — скелетон той же высоты (без CLS-прыжка)", () => {
    mockUseMyBookings.mockReturnValue(queryState({ isLoading: true }));
    mockUseMyTrips.mockReturnValue(
      queryState({
        data: {
          pages: [{ items: [makeTrip({ id: "t-own" })] }],
        },
        isLoading: true,
      }),
    );
    const html = render(<HomePage />);
    expect(html).toContain('aria-label="Загрузка сводки"');
    expect(html).not.toContain("Поездки");
    expect(html).not.toContain("Брони");
    expect(html).not.toContain("Заявки");
  });

  it("без сегментов дня — переход только по нативной «Найти»", () => {
    const html = render(<HomePage />);
    // Сегментов дня и swap на экспресс-поиске нет.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("Сегодня");
    expect(html).not.toContain("Поменять направление");
    // Единственный submit формы — нативная tgui-кнопка «Найти поездку»
    // в футере секции (без кастомных классов вроде rounded-full).
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Найти поездку");
    expect(html).not.toContain("rounded-full");
  });

  it("города — нативные Select-дропдауны справочника", () => {
    const html = render(<HomePage />);
    expect(html).toContain("Откуда");
    expect(html).toContain("Куда");
    // Нативный <select> с опциями справочника (placeholder — disabled-опция).
    expect(html.match(/<select/g)?.length).toBe(2);
    expect(html).toContain("Город или село отправления");
    expect(html).toContain("Город или село назначения");
  });

  it("профиль-бар — тап ведёт в профиль", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { name: "Александр", rating: 4.8 } }),
    );
    const html = render(<HomePage />);
    // Cell-div с onClick (тапы проверены на iPhone): связь по aria-label.
    expect(html).toContain('aria-label="Открыть профиль"');
    expect(html).toContain("Александр");
  });

  it("сводка заявок водителя: кнопка, без досье на главной", () => {
    mockUseDriverRequests.mockReturnValue(
      queryState({ data: [makeDriverRequest()] }),
    );
    const html = render(<HomePage />);
    expect(html).toContain("Заявки");
    // Досье заявки (маршрут, рейтинг, место) — внутри поездки, не на главной.
    expect(html).not.toContain("Вологда → Череповец");
    expect(html).not.toContain("место №1");
  });
});

/** Агрегат ленты спроса: маршрут + люди + места + ближайшее окно. */
function makeFeedItem() {
  return {
    fromCity: { id: "c-1", name: "Вологда" },
    toCity: { id: "c-2", name: "Череповец" },
    people: 2,
    seats: 3,
    nextAt: "2030-06-01T06:00:00.000Z",
  };
}

function makeDriverRequest() {
  return {
    id: "dr-1",
    seat: 1,
    status: "pending",
    expiresAt: null,
    passenger: {
      id: "p-1",
      name: "Пётр",
      avatar: "https://t.me/p.png",
      rating: 4.9,
      reviewsCount: 3,
      tripsCount: 5,
    },
    trip: {
      ...makeTrip(),
      driver: { name: "Я", avatar: "https://t.me/me.png", rating: 5 },
    },
  };
}

describe("HomePage: имя экрана принадлежит странице, а не секции (реестр #15)", () => {
  it("единственный h1 — «Главная», а секция ленты не h1", () => {
    // NavHeader помечен aria-hidden, поэтому имя экрана — у страницы.
    const html = render(<HomePage />);
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
    expect(h1).toHaveLength(1);
    expect(h1[0]).toContain("Главная");
    expect(html).not.toMatch(/<h1[^>]*>[^<]*Кто ищет попутку/);
  });

  it("секция ленты заявок — заголовок второго уровня, не h1", () => {
    mockUseFeed.mockReturnValue(queryState({ data: [makeFeedItem()] }));

    const html = render(<HomePage />);

    expect(html).toMatch(/<h2[^>]*>[^<]*Кто ищет попутку/);
  });
});
