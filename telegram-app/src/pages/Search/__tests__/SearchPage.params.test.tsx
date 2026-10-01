// @vitest-environment jsdom
// B3: SearchPage обязана реагировать на смену ?from/?to/?segment БЕЗ
// перемонтирования. В проде этого не происходит: route-fade в AppRouter
// key'ится одним pathname (иначе смена query роняет скролл и скелетоны),
// поэтому пресет из URL, читаемый в useState-инициализаторе, применялся
// ровно один раз — и повторный переход «Главная → Поиск» с другим
// маршрутом показывал прошлую выдачу.
//
// SSR-файл SearchPage.test.tsx такую гонку увидеть не может: там каждый
// renderToString — свежий маунт с новыми параметрами. Нужен DOM + навигация.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseInfiniteTrips } = vi.hoisted(() => ({
  mockUseInfiniteTrips: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useInfiniteTripsQuery: mockUseInfiniteTrips,
  };
});

import { SearchPage } from "@/pages/Search/SearchPage";

/** Фильтры, с которыми SearchPage реально пошла за выдачей. */
type Captured = Array<Record<string, unknown> | undefined>;
let captured: Captured = [];

function emptyInfinite() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Кнопки навигации: меняют URL, не размонтируя SearchPage. */
function Nav({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      перейти
    </button>
  );
}

function renderSearch(url: string, navTo: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoot>
        <Nav to={navTo} />
        <SearchPage />
      </AppRoot>
    </MemoryRouter>,
  );
}

function lastFilters(): Record<string, unknown> | undefined {
  return captured[captured.length - 1];
}

/**
 * Поля «Откуда»/«Куда». Кортеж, а не массив: под noUncheckedIndexedAccess
 * array[i] даёт T | undefined, и каждый тест получал бы non-null
 * assertions. Здесь тип проверяет наличие полей сам.
 */
function cityInputs(): [from: HTMLInputElement, to: HTMLInputElement] {
  const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
  const from = inputs[0];
  const to = inputs[1];
  if (!from || !to) {
    throw new Error("ожидались поля «Откуда» и «Куда»");
  }
  return [from, to];
}

beforeEach(() => {
  captured = [];
  mockUseInfiniteTrips.mockReset();
  mockUseInfiniteTrips.mockImplementation((filters: unknown) => {
    captured.push(filters as Record<string, unknown> | undefined);
    return emptyInfinite();
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SearchPage: смена URL без перемонтирования (B3)", () => {
  it("happy: переход на другой маршрут обновляет и форму, и выдачу", () => {
    renderSearch("/trips?from=Вологда&to=Череповец", "/trips?from=Москва&to=Тула");

    // Холодный вход — пресет применился на маунте.
    expect(lastFilters()).toMatchObject({
      fromCity: "Вологда",
      toCity: "Череповец",
    });

    fireEvent.click(screen.getByRole("button", { name: "перейти" }));

    // Регрессия B3: без синхронизации остались бы Вологда/Череповец.
    expect(lastFilters()).toMatchObject({
      fromCity: "Москва",
      toCity: "Тула",
    });
    const [from, to] = cityInputs();
    expect(from.value).toBe("Москва");
    expect(to.value).toBe("Тула");
  });

  it("edge: переход на маршрут БЕЗ параметров очищает форму", () => {
    renderSearch("/trips?from=Вологда&to=Череповец", "/trips");

    fireEvent.click(screen.getByRole("button", { name: "перейти" }));

    expect(lastFilters()).toBeUndefined();
    const [from, to] = cityInputs();
    expect(from.value).toBe("");
    expect(to.value).toBe("");
  });

  it("edge: смена только сегмента даты (?segment=today) переносится в выдачу", () => {
    renderSearch("/trips?from=Вологда", "/trips?from=Вологда&segment=today");

    fireEvent.click(screen.getByRole("button", { name: "перейти" }));

    // Дата приходит в выдачу как dateFrom/dateTo, а не как "Сегодня" в UI.
    expect(lastFilters()).toMatchObject({ fromCity: "Вологда" });
    expect(lastFilters()?.dateFrom).toBeTruthy();
    expect(lastFilters()?.dateTo).toBeTruthy();
  });

  it("edge: набор в форме НЕ затирается ререндером с теми же параметрами", () => {
    // Страховка от зацикливания: синхронизация по строке параметров, а не
    // по объекту URLSearchParams (новый объект каждый рендер).
    renderSearch("/trips?from=Вологда", "/trips?from=Вологда");

    const [from] = cityInputs();
    fireEvent.change(from, { target: { value: "Псков" } });
    expect(from.value).toBe("Псков");

    // Переход на ИДЕНТИЧНЫЙ URL: параметры не изменились — набор остаётся.
    fireEvent.click(screen.getByRole("button", { name: "перейти" }));
    expect(cityInputs()[0].value).toBe("Псков");
  });

  it("edge: локальные чипы дат не меняют URL и не сбрасываются", () => {
    renderSearch("/trips?from=Вологда", "/trips?from=Москва");

    fireEvent.click(screen.getByRole("tab", { name: "Сегодня" }));

    // Чип меняет только локальную форму — выдача всё ещё на старом
    // submitted, и параметры URL прежние.
    expect(lastFilters()).toMatchObject({ fromCity: "Вологда" });

    // Нажатие «Найти» применяет локальный набор (segment=today → dateFrom).
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(lastFilters()).toMatchObject({ fromCity: "Вологда" });
    expect(lastFilters()?.dateFrom).toBeTruthy();
  });
});
