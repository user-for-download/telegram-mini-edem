// telegram-app/src/hooks/usePrefersReducedMotion.ts
// Настройка ОС «уменьшить движение» (WCAG 2.3.3).
//
// Нужна там, где анимацию гасит ПРОП компонента, а не CSS-правило.
// У кита анимация скелетона привязана к ОТСУТСТВИЮ хеш-класса
// (`.tgui-…:not(.tgui-…):after`), поэтому перебить её своим
// CSS-правилом можно только повторив этот хеш (ломается при смене
// версии кита — ровно то, о чём предупреждает примечание к
// `[vaul-drawer][vaul-drawer]` в index.css) или выиграв по
// специфичности (то есть `!important`, который в репозитории запрещён).
// Проп `withoutAnimation` кладёт на элемент сам нужный класс, и
// специфичность не при чём: это штатный выключатель кита.
//
// Устройство — как в useOnlineStatus: useSyncExternalStore, а не
// useState + эффект (последний запрещён react-hooks/set-state-in-effect).
import { useSyncExternalStore } from "react";

const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** MediaQueryList либо null, если среда его не умеет.
 *
 * matchMedia отсутствует в jsdom-тестах без стаба и в старых WebView:
 * тогда возвращаем null, и usePrefersReducedMotion() даёт false —
 * анимация остаётся, то есть поведение «как у всех, кто настройку не
 * задавал», вместо тихого выключения движения у части пользователей. */
function mediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCE_MOTION_QUERY);
}

function subscribe(onStoreChange: () => void): () => void {
  const list = mediaQueryList();
  if (!list) return () => {};
  list.addEventListener("change", onStoreChange);
  return () => list.removeEventListener("change", onStoreChange);
}

/** Снапшот — примитив, поэтому useSyncExternalStore не перерисовывает
 *  дерево на каждом вызове (useOnlineStatus устроен так же). */
function getSnapshot(): boolean {
  return mediaQueryList()?.matches ?? false;
}

/** true, если пользователь просил уменьшить движение.
 *
 * Значение живое: смена настройки ОС на лету (пользователь переключил
 * «Уменьшить движение», не перезагружая WebView) обновляет подписчиков
 * и компоненты перерисовываются. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
