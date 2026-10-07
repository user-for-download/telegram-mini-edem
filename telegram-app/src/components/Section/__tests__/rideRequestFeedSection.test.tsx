// SSR-тесты ленты заявок попутчиков на главной.
//
// Сортировку «ближайшие» проверяет бэк (`earliestAt asc`, интеграционный тест
// `backend/tests/integration/ride-requests.test.ts`), здесь — контракт разметки:
// заголовок, строка заявки, подпись, скрытие при пустой ленте и тап в поиск по
// маршруту. Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockFeed } = vi.hoisted(() => ({ mockFeed: vi.fn() }));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestFeedQuery: mockFeed,
}));

import { RideRequestFeedSection } from "@/components/Section/RideRequestFeedSection";

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fromCity: { id: "c-1", name: "Вологда" },
    toCity: { id: "c-2", name: "Череповец" },
    // 06:00Z = 09:00 МСК: в строке должно быть 09:00, а не 06:00 UTC.
    earliestAt: "2030-06-01T06:00:00.000Z",
    latestAt: "2030-06-01T15:00:00.000Z",
    seats: 2,
    status: "active",
    expiresAt: "2030-06-01T15:00:00.000Z",
    createdAt: "2030-05-01T06:00:00.000Z",
    updatedAt: "2030-05-01T06:00:00.000Z",
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
  it("строка: маршрут, московские дата и время, места", () => {
    mockFeed.mockReturnValue(queryState({ data: [request()] }));

    const html = renderSection();

    expect(html).toContain("Кого ищут попутчиком");
    expect(html).toContain("Вологда → Череповец");
    // Время — по Москве (06:00Z → 09:00), иначе в строке было бы UTC.
    expect(html).toContain("09:00");
    expect(html).not.toContain("06:00");
    expect(html).toContain("2 места");
  });

  it("дата окна — человеческая, а не ISO", () => {
    mockFeed.mockReturnValue(queryState({ data: [request()] }));

    const html = renderSection();

    expect(html).toMatch(/1 июня/);
    expect(html).not.toContain("2030-06-01");
  });

  it("имя строки для скринридера несёт маршрут, дату, время и места", () => {
    mockFeed.mockReturnValue(queryState({ data: [request()] }));

    const html = renderSection();

    expect(html).toContain("Нужен попутчик Вологда — Череповец, 1 июня, 09:00, 2 места");
  });

  it("нативная кнопка: строка фокусируется и опознаётся как кнопка", () => {
    mockFeed.mockReturnValue(queryState({ data: [request()] }));

    const html = renderSection();

    // Реестр #12: интерактивная строка обязана быть нативной кнопкой —
    // без Component="button" кит рендерит div, и строка не фокусируется.
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toMatch(/<div[^>]*type="button"/);
  });

  it("заголовок секции — не h1 (имя экрана принадлежит странице)", () => {
    mockFeed.mockReturnValue(queryState({ data: [request()] }));

    const html = renderSection();

    expect(html).toMatch(/<h2[^>]*>[\s\S]*?Кого ищут попутчиком/);
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*?Кого ищут попутчиком/);
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
      expect(renderSection()).not.toContain("Кого ищут попутчиком");
    }
  });
});