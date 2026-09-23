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
 */
export function SheetBody({
  variant = "padded",
  className,
  children,
}: SheetBodyProps) {
  const variantClass = VARIANTS[variant];
  return (
    <div className={className ? `${variantClass} ${className}` : variantClass}>
      {children}
    </div>
  );
}
