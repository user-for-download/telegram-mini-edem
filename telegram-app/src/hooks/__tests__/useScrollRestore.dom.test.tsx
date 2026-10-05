// @vitest-environment jsdom
// DOM-тест useScrollRestore — парный к SSR-файлу useScrollRestore.test.tsx.
//
// Регрессия (аудит 2026-10-05): позиция списка терялась при Back из
// route-модалки. Старая версия читала window.scrollY в эффекте, который
// React запускает ПОСЛЕ подмены DOM; для route-модалок фон списка уходит в
// `hidden`, документ схлопывается, браузер обнуляет scrollY — и сохранялось
// 0. Восстановление по-прежнему приносило 0, список каждый раз открывался
// наверху. SSR-файл этого видеть не мог: там нет ни скролла, ни DOM.
//
// Здесь эмитируем scroll-событие (реальный браузер шлёт его на scrollY),
// а схлопывание документа имитируем обнулением scrollY перед сменой ключа —
// ровно то, что делает браузер, когда фон уезжает в hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  clearScrollPositions,
  readScrollPosition,
  useScrollRestore,
} from "@/hooks/useScrollRestore";

/** Прокрутить «окно»: задать scrollY и выслать событие scroll. */
function scrollWindowTo(top: number): void {
  Object.defineProperty(window, "scrollY", {
    value: top,
    writable: true,
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

/**
 * Схлопывание документа: браузер обнуляет scrollY, когда видимая часть
 * перестаёт быть длиннее вьюпорта (фон route-модалки в `hidden`).
 */
function collapseDocument(): void {
  Object.defineProperty(window, "scrollY", {
    value: 0,
    writable: true,
    configurable: true,
  });
}

function Probe({ routeKey }: { routeKey: string }) {
  useScrollRestore(routeKey);
  return <div>probe</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearScrollPositions();
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "scrollY", {
    value: 0,
    writable: true,
    configurable: true,
  });
  // rAF выполняем СИНХРОННО: восстановление скролла в хуке отложено на
  // кадр после отрисовки, а в jsdom кадр приходит по таймеру — проверять
  // пришлось бы через await act/таймеры. Синхронный rAF делает тест
  // детерминированным и проверяет ровно решение, а не его расписание.
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

// Обязателен: vitest здесь без globals, поэтому авто-cleanup RTL не
// включается. Без него размонтированный scroll-listener остаётся живым
// и пишет позицию по СВОЕМУ (уже прошлому) routeKey — следующий тест
// читал бы испорченное хранилище. Проверено: без cleanup падало 4 из 5.
afterEach(cleanup);

describe("useScrollRestore: позиция снимается, пока маршрут на экране", () => {
  it("скролл списка сохраняется и возвращается по Back, а не как 0", () => {
    const { rerender } = render(<Probe routeKey="/trips" />);

    // Пользователь проскроллил ленту.
    scrollWindowTo(800);

    // Тап по карточке: фон списка уезжает в `hidden`, документ схлопывается
    // ДО того, как эффект перехода успевает прочитать scrollY.
    collapseDocument();
    rerender(<Probe routeKey="/trips/t-1" />);

    // Регрессия ловится здесь: старая версия сохраняла 0.
    expect(readScrollPosition("/trips")).toBe(800);
  });

  it("Back на список восстанавливает проскролленную позицию", () => {
    const { rerender } = render(<Probe routeKey="/trips" />);
    scrollWindowTo(800);
    collapseDocument();
    rerender(<Probe routeKey="/trips/t-1" />);
    collapseDocument();

    rerender(<Probe routeKey="/trips" />);

    expect(readScrollPosition("/trips")).toBe(800);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 800);
  });

  it("скролл после возврата относится к новому маршруту, а не к предыдущему", () => {
    // Регрессия на атрибуцию: если бы scroll-listener писал по старому
    // ключу, восстановление само переписало бы позицию предыдущего
    // маршрута и Back перестал бы работать со второго раза.
    const { rerender } = render(<Probe routeKey="/trips" />);
    scrollWindowTo(800);
    collapseDocument();
    rerender(<Probe routeKey="/trips/t-1" />);

    // Модалка короткая — её скролл 0.
    scrollWindowTo(0);
    expect(readScrollPosition("/trips/t-1")).toBe(0);

    rerender(<Probe routeKey="/trips" />);
    expect(readScrollPosition("/trips")).toBe(800);
  });

  it("позиция модалки (переход туда) не затирает позицию списка", () => {
    const { rerender } = render(<Probe routeKey="/trips" />);
    scrollWindowTo(800);
    collapseDocument();
    rerender(<Probe routeKey="/trips/t-1" />);
    scrollWindowTo(0);

    expect(readScrollPosition("/trips")).toBe(800);
    expect(readScrollPosition("/trips/t-1")).toBe(0);
  });

  it("unmount снимает scroll-listener (нет записи после размонтирования)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Probe routeKey="/trips" />);
    scrollWindowTo(500);

    unmount();
    clearScrollPositions();
    scrollWindowTo(999);

    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    // После размонтирования хранилище не пополняется слушателем.
    expect(readScrollPosition("/trips")).toBeUndefined();
  });
});
