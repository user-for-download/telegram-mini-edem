// Рендер-тесты поиска: лента результатов, пустое состояние со сбросом,
// пагинация «Показать ещё», loading/error через QueryState.
// База (инпуты городов, сегменты дат, пресет из URL) покрыта в
// tripsPages.test.tsx «SearchPage parity» — здесь не дублируется.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
});

const { mockUseInfiniteTrips } = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: () => ({ data: [{ id: "city-1", name: "Вологда" }, { id: "city-2", name: "Череповец" }] }),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteTripsQuery: mockUseInfiniteTrips,
  };
});

import { SearchPage } from "@/pages/Search/SearchPage";
import { ToastProvider } from "@/components/Toast/ToastProvider";

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

function infiniteState(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ...queryState(),
    data: {
      pages: [
        {
          items,
          pagination: {
            hasMore: false,
            page: 1,
            limit: 20,
            total: items.length,
            totalPages: 1,
          },
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function render(element: ReactNode, url = "/trips"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
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
    durationMinutes: 125,
    distanceKm: 140,
    price: 450,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-1",
      name: "Александр",
      rating: 4.9,
      reviewsCount: 12,
      avatar: "https://t.me/a.png",
    },
    tags: [],
    status: "active",
    ...overrides,
  };
}

describe("SearchPage results", () => {
  it("показывает счётчик и карточки найденных поездок", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([makeTrip(), makeTrip({ id: "t-2", price: 300 })]),
    );
    const html = render(<SearchPage />);
    // SSR разбивает текст комментариями: «Найдено поездок: <!-- -->2».
    expect(html).toContain("Найдено поездок:");
    expect(html).toMatch(/Найдено поездок: <!-- -->2/);
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
  });

  it("пустой результат — плейсхолдер со сбросом фильтров", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toMatch(/Найдено поездок: <!-- -->0/);
    expect(html).toContain("Поездок не найдено");
    expect(html).toContain("Сбросить фильтры");
  });

  it("пагинация: кнопка «Показать ещё» только при hasNextPage", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([makeTrip()], { hasNextPage: true }),
    );
    expect(render(<SearchPage />)).toContain("Показать ещё");

    mockUseInfiniteTrips.mockReturnValue(infiniteState([makeTrip()]));
    expect(render(<SearchPage />)).not.toContain("Показать ещё");
  });
});

describe("SearchPage query states", () => {
  it("loading — спиннер вместо ленты", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([], { isLoading: true, data: undefined }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Загрузка");
    expect(html).not.toContain("Поездок не найдено");
  });

  it("ошибка — повтор через refetch", () => {
    const refetch = vi.fn();
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([], {
        data: undefined,
        isError: true,
        error: new Error("network down"),
        refetch,
      }),
    );
    const html = render(<SearchPage />);
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });
});

// У полей города есть доступное имя на всех платформах: связка
// visually-hidden `<label for>` + id поля — канон фасада (ui/Field,
// реестр #9), а не aria-label на контроле: у поля есть ВИДИМАЯ подпись,
// и дублировать её в aria-label значило бы держать текст в двух местах.
describe("SearchPage a11y", () => {
  it("поля городов имеют доступное имя на всех платформах", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toContain('<label for="search-from"');
    expect(html).toContain('<label for="search-to"');
    expect(html).toMatch(/<label for="search-from"[^>]*>Откуда</);
    expect(html).toMatch(/<label for="search-to"[^>]*>Куда</);
  });

  it("выбор города — нативный select с настоящими option (реестр #19)", () => {
    // У селекта option — настоящий элемент, доступный скринридеру.
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toMatch(/<select[^>]*id="search-from"/);
    expect(html).toContain('<option value="city-1">Вологда</option>');
    expect(html).not.toContain("request-cities");
  });

  it("id полей сохранены (контракт e2e #search-from / #search-to)", () => {
    mockUseInfiniteTrips.mockReturnValue(infiniteState([]));
    const html = render(<SearchPage />);
    expect(html).toContain('id="search-from"');
    expect(html).toContain('id="search-to"');
  });
});

describe("лента с пилюлями дат", () => {
  // Фикстура как реальный ответ бэка: date — отформатированная подпись
  // «сб, 15 марта», ISO-дата живёт в departureAt. Фикстура с ISO в `date`
  // проверяла бы несуществующий контракт и маскировала бы группировку.
  const trip = (id: string, departureAt: string) => ({
    id,
    fromCity: "Вологда",
    toCity: "Череповец",
    date: new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      weekday: "short",
      timeZone: "Europe/Moscow",
    }).format(new Date(departureAt)),
    time: "10:00",
    departureAt,
    durationMinutes: 60,
    distanceKm: 100,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-driver",
      name: "Иван Водителев",
      avatar: "https://t.me/i/userpic/320/avatar.svg",
      rating: 4.8,
      reviewsCount: 1,
      tripsCount: 5,
    },
    tags: [],
  });

  /** Тексты пилюль-заголовков (h2), без вложенного span. */
  const pillsOf = (html: string): string[] =>
    [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
    );

  it("пилюля — день московский, карточки под своей датой", () => {
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([
        trip("t-1", "2031-03-15T06:00:00.000Z"),
        trip("t-2", "2031-03-16T06:00:00.000Z"),
        trip("t-3", "2031-03-15T09:00:00.000Z"),
      ]),
    );
    const html = render(<SearchPage />);
    // Порядок карточек бэка (15, 16, 15) не переставляется: день, разорванный
    // другим, даёт вторую группу, а не схлопывает первые две.
    expect(pillsOf(html)).toEqual(["15 марта", "16 марта", "15 марта"]);
    // Все три карточки на месте, ни одна не потерялась в группировке.
    expect(html.match(/Иван Водителев/g)).toHaveLength(3);
  });

  it("в пилюле только подпись дня, без счётчика", () => {
    // Счётчик обещал бы число по группе, разрезанной страницами инфинит-ленты.
    mockUseInfiniteTrips.mockReturnValue(
      infiniteState([
        trip("t-1", "2031-03-15T06:00:00.000Z"),
        trip("t-2", "2031-03-15T09:00:00.000Z"),
      ]),
    );
    const html = render(<SearchPage />);
    expect(pillsOf(html)).toEqual(["15 марта"]);
  });
});
