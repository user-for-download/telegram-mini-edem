import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export interface SheetBodyProps {
  /**
   * "padded" (по умолчанию) — скролл 82dvh, бока 16 (5 копий `.sheetBody`);
   * "edge" — без боковых (контент сам держит рельс, отзывы);
   * "static" — без скролла (короткая форма обратной связи).
   */
  variant?: "padded" | "edge" | "static";
  className?: string;
  children: ReactNode;
}

const VARIANTS = {
  padded: styles.sheetBody,
  edge: styles.sheetBodyEdge,
  static: styles.sheetBodyStatic,
} as const;

/**
 * Тело sheet-модалки: div со скроллом и отступами из токенов
 * (`--app-sheet-*`), ритм 12 — тот же, что у страниц и тел секций,
 * поэтому вложенные `.stack*`-обёртки с собственным gap больше не нужны.
 *
 * Обычный div (не List) по той же причине, что SectionBody/Stack:
 * внутри экрана List приносит только платформенный паддинг и чужое
 * значение ритма.
 *
 * Минимальный фокус-менеджмент шторки: контейнер — программная цель
 * (tabIndex={-1}, вне таб-порядка), при монтировании — т.е. при открытии
 * шторки — переносим на него фокус: точка входа для клавиатуры и
 * скринридера. Дальше — нативный trap vaul (Tab внутри шторки, Esc —
 * закрыть, фокус возвращается на триггер): своих role="dialog" и
 * focus-trap не добавляем. preventScroll — шторка сама анимируется,
 * прыжок страницы не нужен. Видимое кольцо — только для клавиатуры
 * (:focus-visible в ui.module.css, канон WCAG 2.4.7).
 */
export function SheetBody({
  variant = "padded",
  className,
  children,
}: SheetBodyProps) {
  const variantClass = VARIANTS[variant];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={className ? `${variantClass} ${className}` : variantClass}
    >
      {children}
    </div>
  );
}
