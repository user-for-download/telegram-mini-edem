// SSR-тесты ленты спроса на главной (суммаризатор по маршрутам).
//
// Агрегацию и сортировку проверяет бэк (интеграционный тест
// `backend/tests/integration/ride-requests.test.ts`): тут контракт разметки —
// заголовок, «люди + места + ближайшая дата», скрытие при пустой ленте и
// анонимность (в строке нет id заявки). Паттерн tripsPages.test.tsx (SSR).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockFeed } = vi.hoisted(() => ({ mockFeed: vi.fn() }));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestFeedQuery: mockFeed,
}));

import { RideRequestFeedSection } from "@/components/Section/RideRequestFeedSection";

function item(overrides: Record<string, unknown> = {}) {
  return {
    fromCity: { id: "c-1", name: "Вологда" },
    toCity: { id: "c-2", name: "Череповец" },
    people: 2,
    seats: 3,
    // 06:00Z = 09:00 МСК: в строке должно быть 09:00, а не 06:00 UTC.
    nextAt: "2030-06-01T06:00:00.000Z",
    ...overrides,
  };
}

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

function renderSection(
  onSelect: (fromCityId: string, toCityId: string) => void = () => {},
): string {
  return renderToString(
    <AppRoot platform="base">
      <RideRequestFeedSection onSelect={onSelect} />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockFeed.mockReturnValue(queryState({ data: [] }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RideRequestFeedSection", () => {
  it("строка: маршрут, люди, места и ближайшая дата по Москве", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    expect(html).toContain("Кто ищет попутку");
    expect(html).toContain("Вологда → Череповец");
    // Подпись строки ЦЕЛИКОМ: так ловится и лишнее слово («ищут»), и обрыв
    // текста. Проверять по кускам нельзя — те же слова есть в aria-label, и
    // ассерт проходил бы по нему, а не по видимой строке.
    expect(html).toContain("2 человека · 3 места · 1 июня, 09:00");
    // Время — по Москве (06:00Z → 09:00), иначе в строке было бы UTC.
    expect(html).toContain("09:00");
    expect(html).not.toContain("06:00");
  });

  it("люди и места — разные числа: один человек может просить три места", () => {
    // «1 человек» не значит «нужно 1 место», поэтому в строке оба.
    mockFeed.mockReturnValue(
      queryState({ data: [item({ people: 1, seats: 3 })] }),
    );

    const html = renderSection();

    expect(html).toContain("1 человек · 3 места");
  });

  it("строка — та же MenuRow, что в меню профиля", () => {
    // Витрина спроса обязана читаться как пункты меню. Свой Cell без
    // `width: 100%` раздувал строку за карточку (553px при секции 356px) и
    // гонял подпись в две строки, из-за чего шеврон висел посередине.
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    // Имя строки собирает MenuRow: «{label}. {subtitle}».
    expect(html).toContain(
      "Заявки Вологда — Череповец. 2 человека · 3 места · 1 июня, 09:00",
    );
    // Ширину держит MenuRow (ui/__tests__/menuRow.test.ts пинит width: 100%).
  });

  it("дата — человеческая, а не ISO", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    expect(html).toMatch(/1 июня/);
    expect(html).not.toContain("2030-06-01");
  });

  it("подпись строки — одна строка: люди, места, ближайшее окно", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    expect(html).toContain("2 человека · 3 места · 1 июня, 09:00");
  });

  it("строка не содержит id заявки: лента анонимная", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    // В агрегате нет ни автора, ни id отдельных заявок — только маршрут.
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("нативная кнопка: строка фокусируется и опознаётся как кнопка", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    // Реестр #12: интерактивная строка обязана быть нативной кнопкой —
    // без Component="button" кит рендерит div, и строка не фокусируется.
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toMatch(/<div[^>]*type="button"/);
  });

  it("заголовок секции — не h1 (имя экрана принадлежит странице)", () => {
    mockFeed.mockReturnValue(queryState({ data: [item()] }));

    const html = renderSection();

    expect(html).toMatch(/<h2[^>]*>[\s\S]*?Кто ищет попутку/);
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*?Кто ищет попутку/);
  });

  it("пустая лента, загрузка и ошибка — секции нет вовсе", () => {
    // Витрина спроса не должна занимать место на главной заголовком без
    // строк; проверяем отсутствие заголовка, а не пустую строку: в HTML
    // остаётся обёртка AppRoot.
    for (const state of [
      queryState({ data: [] }),
      queryState({ isLoading: true }),
      queryState({ isError: true, error: new Error("Нет соединения") }),
    ]) {
      mockFeed.mockReturnValue(state);
      expect(renderSection()).not.toContain("Кто ищет попутку");
    }
  });
});