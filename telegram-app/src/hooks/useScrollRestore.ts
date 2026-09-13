// telegram-app/src/hooks/useScrollRestore.ts
// P2 list-perf: возврат scrollTop при Back из route-модалки.
//
// Собственная реализация идеи «якорного» восстановления позиции
// (позиция хранится по ключу маршрута): уход со списка сохраняет
// window.scrollY, возврат — восстанавливает; прямой вход без
// сохранённой позиции — наверх. State-модалки (handleModalBack)
// локацию не меняют, поэтому хук их не трогает.
// SSR-safe: весь доступ к window/document — только внутри эффектов
// с typeof-гардами; renderToString рендер не роняет.
import { useEffect, useRef } from "react";

// Верхняя граница in-memory хранилища (FIFO-вытеснение старейших).
const MAX_ENTRIES = 24;

const positions = new Map<string, number>();

/** Ключ маршрута для хранилища: путь + query (сегменты списков различаются). */
export function routeScrollKey(pathname: string, search?: string): string {
  if (!search) return pathname;
  return `${pathname}${search}`;
}

/**
 * Сохранить scrollTop за ключом. Пустой ключ и не-числа игнорируются
 * (граница unknown → сужение через typeof, без unknown-leak).
 */
export function saveScrollPosition(key: string, top: unknown): void {
  if (key.length === 0) return;
  if (typeof top !== "number" || !Number.isFinite(top)) return;
  if (positions.has(key)) positions.delete(key);
  positions.set(key, Math.max(0, top));
  while (positions.size > MAX_ENTRIES) {
    const oldest = positions.keys().next();
    if (oldest.done) break;
    positions.delete(oldest.value);
  }
}

/** Прочитанная позиция или undefined (нет сохранения / неизвестный ключ). */
export function readScrollPosition(key: string): number | undefined {
  if (key.length === 0) return undefined;
  return positions.get(key);
}

/** Очистить хранилище (смена пользователя, тесты). */
export function clearScrollPositions(): void {
  positions.clear();
}

export interface RouteTransition {
  /** Что сохранить за предыдущий ключ (null — первый монт, сохранять нечего). */
  save: { key: string; top: number } | null;
  /** Куда проскроллить новый маршрут: сохранение или верх. */
  restoreTop: number;
  /** Навигация (не первый монт) — вернуть фокус контенту. */
  shouldRestoreFocus: boolean;
}

/**
 * Чистое решение перехода prev → next: сохранить текущий скролл за prev,
 * восстановить позицию next. Тестируется без DOM.
 */
export function planRouteTransition(
  prevKey: string | null,
  nextKey: string,
  currentY: number,
): RouteTransition {
  if (prevKey === null || prevKey === nextKey) {
    return {
      save: null,
      restoreTop: readScrollPosition(nextKey) ?? 0,
      shouldRestoreFocus: false,
    };
  }
  return {
    save: { key: prevKey, top: currentY },
    restoreTop: readScrollPosition(nextKey) ?? 0,
    shouldRestoreFocus: true,
  };
}

/**
 * Вернуть фокус landmark контента после навигации назад.
 * Не вырывает фокус из интерактива и не дёргает скролл
 * (a11y: без ловушки скролла).
 */
function focusShellContent(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active !== null && active !== document.body) return;
  const main = document.querySelector("main.AppShell__content");
  if (main instanceof HTMLElement) main.focus({ preventScroll: true });
}

/**
 * Сохраняет window.scrollY за предыдущим ключом маршрута и
 * восстанавливает позицию нового. Вызывать в Shell с ключом
 * routeScrollKey(location.pathname, location.search).
 */
export function useScrollRestore(routeKey: string): void {
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentY = typeof window.scrollY === "number" ? window.scrollY : 0;
    const plan = planRouteTransition(prevKey.current, routeKey, currentY);
    prevKey.current = routeKey;
    if (plan.save) saveScrollPosition(plan.save.key, plan.save.top);

    // Восстановление после отрисовки — контент списка/модалки уже в DOM.
    const apply = () => {
      window.scrollTo(0, plan.restoreTop);
      if (plan.shouldRestoreFocus) focusShellContent();
    };
    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(apply);
      return () => window.cancelAnimationFrame(frame);
    }
    apply();
  }, [routeKey]);
}
