// @vitest-environment jsdom
// Регресс F13, пятый вызов: `useInfiniteSentinel` в `RideRequestsList`.
//
// Четыре ленты (Search, Notifications, TripActive, TripHistory) получили
// `disabled` ещё в прошлом subtask; эта — нет. Дефект тот же: после сбоя
// страницы N+1 `hasNextPage` остаётся истинным, а плейсхолдер догрузки
// вставляется/убирается и возвращает сентинел во вьюпорт — observer бьёт по
// кругу бесконечными запросами (MEMORY.md §18).
//
// jsdom не умеет IntersectionObserver, поэтому ставим управляемый handle и
// триггерим пересечение руками (форма стенда — как в
// `useInfiniteSentinel.disabled.dom.test.tsx`): проверяется сам факт подписки.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

type ObserverCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

interface ObserverHandle {
  callback: ObserverCallback;
  observe: ReturnType<typeof vi.fn>;
}

/** Стаб IntersectionObserver: запоминает колбэк, но сам не сообщает о пересечении. */
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
        handles.push({ callback, observe: this.observe });
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

const { mockUseRequests, mockUseUpdate, mockUseStatus, mockUseCancel } =
  vi.hoisted(() => ({
    mockUseRequests: vi.fn(),
    mockUseUpdate: vi.fn(),
    mockUseStatus: vi.fn(),
    mockUseCancel: vi.fn(),
  }));

vi.mock("@/queries/useRideRequestsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useRideRequestsQuery")>();
  return {
    ...original,
    useRideRequestsQuery: mockUseRequests,
    useUpdateRideRequestMutation: mockUseUpdate,
    useRideRequestStatusMutation: mockUseStatus,
    useCancelRideRequestMutation: mockUseCancel,
    useCreateRideRequestMutation: vi.fn(),
  };
});

import { RideRequestsList } from "@/components/Trip/RideRequestsList";

function makeRequest() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fromCity: { id: "c-1", name: "Москва" },
    toCity: { id: "c-2", name: "Тула" },
    earliestAt: "2030-01-02T10:00:00.000Z",
    latestAt: "2030-01-02T14:00:00.000Z",
    seats: 2,
    status: "active",
    expiresAt: "2030-01-02T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

/**
 * Снимок `useRideRequestsQuery` с бесконечной лентой.
 *
 * `error` держим `null`: страница отдаёт его в `QueryState` через
 * `listBlockingError`, а при `settles` ошибки следующей страницы лента должна
 * остаться нарисованной — иначе до сентинела не дойти. Это ровно то
 * состояние, ради которого лента и глохнет.
 */
function requestsState(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      pages: [
        {
          items: [makeRequest()],
          pagination: {
            page: 1,
            limit: 20,
            total: 40,
            totalPages: 2,
            hasMore: true,
          },
        },
      ],
    },
    error: null,
    isError: false,
    isLoading: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderList() {
  return render(
    <AppRoot platform="base">
      <RideRequestsList onCreate={vi.fn()} />
    </AppRoot>,
  );
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("scrollY", 0);
  mockUseUpdate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
  mockUseStatus.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
  mockUseCancel.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
  mockUseRequests.mockReturnValue(requestsState());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RideRequestsList: сентинел останавливается на сбое страницы N+1", () => {
  it("пока ошибки нет — сентинел подписан и догружает", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    mockUseRequests.mockReturnValue(requestsState({ fetchNextPage }));

    const { container } = renderList();

    // Узел сентинела в DOM (FetchMore рисуется по hasNextPage) — разница
    // не в отрисовке, а именно в подписке observer'а.
    expect(container.querySelector("div[aria-hidden='true']")).not.toBeNull();
    expect(handles).toHaveLength(1);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("после сбоя страницы N+1 — наблюдение выключено, повторной догрузки нет", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    // hasNextPage после сбоя остаётся истинным — ровно тот случай F13.
    mockUseRequests.mockReturnValue(
      requestsState({ isFetchNextPageError: true, fetchNextPage }),
    );

    const { container } = renderList();

    expect(container.querySelector("div[aria-hidden='true']")).not.toBeNull();
    expect(handles).toHaveLength(0);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("переход «ошибка → здоров» — подписка возвращается", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    mockUseRequests.mockReturnValue(
      requestsState({ isFetchNextPageError: true, fetchNextPage }),
    );
    const { rerender } = renderList();
    expect(handles).toHaveLength(0);

    // Пользователь нажал «Повторить загрузку», запрос прошёл — флаг гаснет.
    mockUseRequests.mockReturnValue(requestsState({ fetchNextPage }));
    // Список завёрнут в memo и пропсов не имеет, поэтому на том же элементе
    // React.memo вышел бы, не перерисовав дерево. Меняем key обёртки — это
    // единственный способ честно смоделировать возврат из состояния ошибки.
    rerender(
      <AppRoot platform="base">
        <RideRequestsList key="recovered" onCreate={vi.fn()} />
      </AppRoot>,
    );

    expect(handles).toHaveLength(1);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
