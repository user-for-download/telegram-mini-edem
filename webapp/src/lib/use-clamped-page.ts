import type { Dispatch, SetStateAction } from "react";

import { clampPageIndex } from "./page-clamp";

/**
 * Держит индекс страницы внутри диапазона [1, totalPages] и возвращает
 * фактически загруженный индекс.
 *
 * Прижимка выполняется фазой рендера: React успевает перерисовать компонент
 * с исправленным индексом до коммита, поэтому список «моргнуть» пустым не
 * успевает. Тот же приём уже применён в CitiesPage (сброс формы при смене
 * цели) — setState в эффекте запрещён правилом react-hooks/set-state-in-effect.
 *
 * Пока ответ не пришёл, диапазон неизвестен (totalPages === undefined) и
 * прижимать нечего: иначе клик «Вперёд» сбрасывал бы страницу на 1 на каждом
 * новом запросе.
 */
export function useClampedPageIndex(
  page: number,
  totalPages: number | undefined,
  setPage: Dispatch<SetStateAction<number>>,
): number {
  if (totalPages === undefined) return page;
  const clamped = clampPageIndex(page, totalPages);
  if (clamped !== page) setPage(clamped);
  return clamped;
}