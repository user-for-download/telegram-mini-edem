// @vitest-environment jsdom
// Регрессия F13: автодогрузка обязана останавливаться на ошибке следующей
// страницы (MEMORY.md:511 — «load more только когда сервер сказал данных
// мало, и СТОП на isFetchNextPageError»).
//
// Дефект был не в хуке, а в вызовах: ни одна из четырёх бесконечных лент
// не передавала `disabled`. После сбоя страницы N+1 `hasNextPage` остаётся
// истинным, плейсхолдер догрузки вставляется/убирается и сдвигает сентинел
// в вьюпорт и обратно — observer перестреливает бесконечно.
//
// Форма стенда повторяет useInfiniteSentinel.dom.test.tsx: jsdom не умеет
// IntersectionObserver, поэтому ставим управляемый handle и триггерим
// пересечение руками.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { FetchMore } from "@/ui/FetchMore";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";

type ObserverCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

interface ObserverHandle {
  callback: ObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/**
 * Стаб IntersectionObserver: запоминает колбэк и observe-вызовы, но НЕ
 * сообщает о пересечении сам — пересечение инициирует тест через
 * triggerIntersect(). Так проверяется именно факт подписки: если
 * сентинел отключён, handle'ов не появится вовсе.
 */
function installObserver(): { handles: ObserverHandle[] } {
  const handles: ObserverHandle[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      callback: ObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
      root = null;
      rootMargin = "";
      thresholds: readonly number[] = [];

      constructor(callback: ObserverCallback) {
        this.callback = callback;
        handles.push({
          callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
  return { handles };
}

function triggerIntersect(handle: ObserverHandle): void {
  handle.callback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

/** Хост-компонент: те же опции, что страницы передают в хук. */
function Host({
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage = false,
  disabled = false,
}: {
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage?: boolean;
  disabled?: boolean;
}) {
  const sentinelRef = useInfiniteSentinel({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    disabled,
  });
  return (
    <FetchMore
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
      sentinelRef={sentinelRef}
    />
  );
}

/** ui/Button внутри FetchMore читает контекст AppRoot — обёртка per-file. */
function renderHost(ui: ReactNode) {
  const result = render(<AppRoot>{ui}</AppRoot>);
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(<AppRoot>{next}</AppRoot>),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "scrollTo",
    vi.fn(),
  );
  vi.stubGlobal("scrollY", 0);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useInfiniteSentinel: disabled глушит наблюдение", () => {
  it("направление «здоров» — сентинел подписан и догружает", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    expect(handles).toHaveLength(1);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("направление «ошибка» — подписки нет вовсе, догрузка невозможна", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} disabled />);

    // Observer не создаётся — значит и пересечение ничего не вызовет.
    expect(handles).toHaveLength(0);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("переход «ошибка → здоров» — подписка возвращается и догрузка идёт", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHost(
      <Host hasNextPage fetchNextPage={fetchNextPage} disabled />,
    );
    expect(handles).toHaveLength(0);

    // Пользователь нажал «Повторить загрузку», запрос прошёл — флаг гаснет.
    rerender(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    expect(handles).toHaveLength(1);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("переход «здоров → ошибка» — подписка снимается и НЕ пересоздаётся", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHost(
      <Host hasNextPage fetchNextPage={fetchNextPage} />,
    );
    expect(handles).toHaveLength(1);

    // Страница N+1 упала: сентинел обязан молчать до явного повтора.
    rerender(<Host hasNextPage fetchNextPage={fetchNextPage} disabled />);

    expect(handles).toHaveLength(1);
    expect(handles.at(-1)?.disconnect).toHaveBeenCalledTimes(1);
    expect(handles.at(-1)?.observe).toHaveBeenCalledTimes(1);
  });
});

/**
 * Страничный уровень: те же четыре ленты, что в проде, берут флаг ошибки
 * прямо из useInfiniteQuery. Проверяем на TripHistoryPage — она thinner
 * всех (архив водителя одним запросом), но контракт ровно тот же.
 */
describe("страница: isFetchNextPageError доходит до сентинела", () => {
  it("пока ошибки нет — лента догружается при пересечении", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    mockInfiniteArchive.mockReturnValue(
      archiveState({ hasNextPage: true, fetchNextPage }),
    );
    const { container } = renderPage();

    expect(container.querySelector("div[aria-hidden='true']")).not.toBeNull();
    expect(handles).toHaveLength(1);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("после сбоя страницы N+1 — наблюдение выключено, повторной догрузки нет", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    // hasNextPage после сбоя остаётся истинным — ровно тот случай F13.
    mockInfiniteArchive.mockReturnValue(
      archiveState({
        hasNextPage: true,
        isFetchNextPageError: true,
        fetchNextPage,
      }),
    );
    const { container } = renderPage();

    // Узел сентинела в DOM есть (FetchMore рисуется по hasNextPage) — то
    // есть разница не в отрисовке, а именно в подписке observer'а.
    expect(container.querySelector("div[aria-hidden='true']")).not.toBeNull();
    expect(handles).toHaveLength(0);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});

const { mockPassengerHistory, mockInfiniteArchive } = vi.hoisted(() => ({
  mockPassengerHistory: vi.fn(),
  mockInfiniteArchive: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useBookingsQuery")>();
  return { ...original, usePassengerHistoryQuery: mockPassengerHistory };
});

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return { ...original, useInfiniteMyTripsQuery: mockInfiniteArchive };
});

import { TripHistoryPage } from "@/pages/TripHistory/TripHistoryPage";

function makeTrip() {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    departureAt: "2030-06-01T09:00:00.000Z",
    time: "09:00",
    price: 450,
    status: "completed",
  };
}

function archiveState(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items: [makeTrip()], pagination: { hasMore: false } }] },
    // error держим null: страница отдаёт его в QueryState и при settles
    // ошибки следующей страницы уводит ленту в терминальный экран. Здесь мы
    // изолируем ровно свой контракт — что страница передаёт сентинелу флаг
    // isFetchNextPageError, пока список ещё нарисован.
    error: null,
    isError: false,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/profile/history"]}>
        <TripHistoryPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockPassengerHistory.mockReturnValue({ data: [], isLoading: false });
  mockInfiniteArchive.mockReturnValue(archiveState());
});
