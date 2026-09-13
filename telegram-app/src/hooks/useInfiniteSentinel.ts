// telegram-app/src/hooks/useInfiniteSentinel.ts
// Сентинел бесконечной прокрутки: IntersectionObserver подгружает
// следующую страницу, когда якорь в конце списка входит в вьюпорт.
//
// Собственная реализация (идеи из анализа официальных клиентов —
// только паттерны, без чужого кода):
// - SSR-safe: без IntersectionObserver (renderToString / node) хук
//   возвращает ref и ничего не делает — контент рендерится сразу,
//   видна fallback-кнопка «Показать ещё»;
// - guard двойного срабатывания: флаг in-flight + isFetchingNextPage;
// - cleanup: observer.disconnect() при размонтировании;
// - якорь скролла: сентинел фиксированной высоты (min-h) не даёт
//   вьюпорту прыгать при схлопывании скелетона; страховка — возврат
//   scrollTop при микро-сдвиге, осознанный скролл пользователя не трогаем.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface InfiniteSentinelOptions {
  /** Есть ли ещё страницы (hasNextPage из useInfiniteQuery). */
  hasNextPage: boolean | undefined;
  /** Идёт ли догрузка (isFetchingNextPage из useInfiniteQuery). */
  isFetchingNextPage: boolean;
  /** Догрузить следующую страницу (fetchNextPage из useInfiniteQuery). */
  fetchNextPage: () => void | Promise<unknown>;
  /** За сколько до вьюпорта начинать подгрузку. */
  rootMargin?: string;
  /** Полностью отключить наблюдение (например, открыта ошибка). */
  disabled?: boolean;
}

/** Максимальный «случайный» сдвиг, который правим якорем (px). */
const ANCHOR_FIX_TOLERANCE_PX = 64;

/** Предзагрузка: начинать тянуть страницу за 320px до сентинела. */
const DEFAULT_ROOT_MARGIN = "320px 0px";

function readScrollTop(): number | null {
  try {
    if (typeof window === "undefined") return null;
    return window.scrollY;
  } catch {
    return null;
  }
}

export function useInfiniteSentinel(
  options: InfiniteSentinelOptions,
): RefObject<HTMLDivElement | null> {
  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    rootMargin = DEFAULT_ROOT_MARGIN,
    disabled = false,
  } = options;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Свежие значения для колбэка observer без пересоздания подписки.
  const stateRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  stateRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };
  // Guard двойного срабатывания: observer может выстрелить несколько
  // раз до того, как react-query поднимет isFetchingNextPage.
  const inFlightRef = useRef(false);
  // Якорь скролла: позиция вьюпорта перед догрузкой.
  const anchorTopRef = useRef<number | null>(null);
  const wasFetchingRef = useRef(false);

  // Сброс in-flight при завершении догрузки.
  useEffect(() => {
    if (isFetchingNextPage) {
      wasFetchingRef.current = true;
      return;
    }
    inFlightRef.current = false;
    if (!wasFetchingRef.current) return;
    wasFetchingRef.current = false;
    // Контент дописывается НИЖЕ вьюпорта, scrollTop обязан остаться тем же.
    // Скелетон живёт внутри сентинела фиксированной высоты, поэтому сдвига
    // в норме нет; страховка — вернуть якорь при микро-сдвиге от схлопывания,
    // но не трогать осознанный скролл пользователя (дельта больше допуска).
    const saved = anchorTopRef.current;
    anchorTopRef.current = null;
    if (saved === null) return;
    const current = readScrollTop();
    if (current === null) return;
    const drift = saved - current;
    if (drift > 1 && drift <= ANCHOR_FIX_TOLERANCE_PX) {
      try {
        window.scrollTo({ top: saved });
      } catch {
        // Не-браузерное окружение — игнорируем.
      }
    }
  }, [isFetchingNextPage]);

  useEffect(() => {
    if (disabled) return;
    // SSR / renderToString: observer отсутствует — выходим тихо,
    // контент уже отрендерен, работает fallback-кнопка.
    if (typeof IntersectionObserver === "undefined") return;
    const element = sentinelRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const state = stateRef.current;
        if (!state.hasNextPage || state.isFetchingNextPage) return;
        if (inFlightRef.current) return;
        const visible = entries.some((entry) => entry.isIntersecting);
        if (!visible) return;
        inFlightRef.current = true;
        anchorTopRef.current = readScrollTop();
        try {
          const result = state.fetchNextPage();
          // fetchNextPage void | Promise: promise-ветку не ждём здесь —
          // сброс in-flight идёт по isFetchingNextPage (эффект выше).
          void result;
        } catch {
          inFlightRef.current = false;
          anchorTopRef.current = null;
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [disabled, rootMargin]);

  return sentinelRef;
}
