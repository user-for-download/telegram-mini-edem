// @vitest-environment jsdom
// DOM-тесты сентинела автодогрузки — парный к SSR-файлу
// infiniteSentinel.test.tsx (node/renderToString, IntersectionObserver
// отсутствует). Здесь observer РЕАЛЬНЫЙ (стаб с ручным триггером),
// поэтому проверяется то, что SSR-ветка увидеть не может: подписка
// навешивается на узел, который появляется ПОСЛЕ загрузки данных.
//
// Регрессия B1: эффект подписки имел deps [disabled, rootMargin] и
// выходил при sentinelRef.current === null. Сентинел рендерит
// ui/FetchMore, а тот — только при hasNextPage, т.е. узел появлялся
// на следующем рендере, когда эффект уже не перезапускался:
// IntersectionObserver не создавался НИКОГДА, автодогрузка не
// работала ни на одном из 4 экранов (работала только кнопка
// «Показать ещё»). Тесты ниже обязаны падать на старом коде.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
 * сообщает об Intersection сам — пересечение инициирует тест вручную
 * через triggerIntersect(). Так проверяется именно факт подписки.
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

/** Хост-компонент: сначала без страниц, потом с ними (как в жизни). */
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

/**
 * ui/Button внутри FetchMore — китовая кнопка, читает контекст AppRoot
 * (конвенция репо: обёртка per-file, setup-файла нет). rerender тоже
 * переоборачивает, иначе AppRoot выпал бы из дерева на втором рендере.
 */
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

describe("useInfiniteSentinel: браузерная ветка (IntersectionObserver есть)", () => {
  it("happy: узел появляется вместе с hasNextPage — observer подписывается на него", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHost(
      <Host hasNextPage={false} fetchNextPage={fetchNextPage} />,
    );

    // hasNextPage=false → FetchMore не рендерит сентинел: подписки нет.
    expect(handles).toHaveLength(0);

    // Данные пришли: узел появился на ЭТОМ рендере — подписка обязана быть.
    rerender(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    expect(handles.length).toBeGreaterThan(0);
    expect(handles.at(-1)?.observe).toHaveBeenCalledTimes(1);
  });

  it("edge: сентинел виден в DOM и скрыт от скринридера", () => {
    installObserver();
    const { container } = renderHost(
      <Host hasNextPage fetchNextPage={vi.fn()} />,
    );

    const sentinel = container.querySelector("div[aria-hidden='true']");
    expect(sentinel).not.toBeNull();
  });

  it("edge: пересечение сентинела догружает страницу БЕЗ клика по кнопке", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    expect(fetchNextPage).not.toHaveBeenCalled();
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("edge: повторное пересечение не догружает (guard in-flight)", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    triggerIntersect(handles.at(-1)!);
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("edge: без пересечения страница не догружается", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    handles.at(-1)!.callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("edge: конец списка гасит observer даже при позднем рендере", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHost(
      <Host hasNextPage fetchNextPage={fetchNextPage} />,
    );
    expect(handles.length).toBeGreaterThan(0);

    rerender(<Host hasNextPage={false} fetchNextPage={fetchNextPage} />);
    expect(handles.at(-1)?.disconnect).toHaveBeenCalled();

    // Пересечение после конца списка ничего не догружает.
    fetchNextPage.mockClear();
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("edge: размонтирование снимает подписку (нет утечек observer'ов)", () => {
    const { handles } = installObserver();
    const { unmount } = renderHost(
      <Host hasNextPage fetchNextPage={vi.fn()} />,
    );
    const handle = handles.at(-1)!;

    unmount();
    expect(handle.disconnect).toHaveBeenCalledTimes(1);
  });

  it("edge: disabled не подписывается вовсе", () => {
    const { handles } = installObserver();

    renderHost(<Host hasNextPage fetchNextPage={vi.fn()} disabled />);
    expect(handles).toHaveLength(0);
  });

  it("edge: переезд на другой узел переподписывает, старая подписка снята", () => {
    const { handles } = installObserver();
    function SwitchHost({ page }: { page: number }) {
      const sentinelRef = useInfiniteSentinel({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      });
      return (
        <div>
          <span>{page}</span>
          <FetchMore
            key={page}
            hasNextPage
            isFetchingNextPage={false}
            fetchNextPage={vi.fn()}
            sentinelRef={sentinelRef}
          />
        </div>
      );
    }

    const { rerender } = renderHost(<SwitchHost page={1} />);
    const first = handles.at(-1)!;
    rerender(<SwitchHost page={2} />);

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(handles.at(-1)!.observe).toHaveBeenCalledTimes(1);
    expect(handles.at(-1)!.disconnect).not.toHaveBeenCalled();
  });

  it("edge: без IntersectionObserver (SSR/node) рендер не падает, кнопка работает", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const fetchNextPage = vi.fn();
    renderHost(<Host hasNextPage fetchNextPage={fetchNextPage} />);

    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("edge: лишние ререндеры не плодят observer'ы", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHost(
      <Host hasNextPage fetchNextPage={fetchNextPage} />,
    );
    const afterFirst = handles.length;

    for (let i = 0; i < 3; i++) {
      rerender(<Host hasNextPage fetchNextPage={fetchNextPage} />);
    }
    expect(handles.length).toBe(afterFirst);
  });

  it("edge: догрузка поднимает isFetchingNextPage и гасит повторное пересечение", () => {
    const { handles } = installObserver();
    const fetchNextPage = vi.fn();
    function BusyHost() {
      const [busy, setBusy] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setBusy(true)}>
            начать
          </button>
          <Host
            hasNextPage
            isFetchingNextPage={busy}
            fetchNextPage={() => {
              fetchNextPage();
              setBusy(true);
            }}
          />
        </div>
      );
    }
    renderHost(<BusyHost />);

    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "начать" }));
    triggerIntersect(handles.at(-1)!);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
