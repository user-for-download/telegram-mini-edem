import type { HTMLAttributes, ReactNode } from "react";
import { Card as TguiCard } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /**
   * default — паддинг 16 (основная поверхность лент и секций);
   * flush — 0 (тело держит раскладку само).
   */
  variant?: "default" | "flush";
  children: ReactNode;
}

const VARIANTS = {
  default: styles.cardDefault,
  flush: styles.cardFlush,
} as const;

/**
 * Единая карточка приложения на нативном `Card` кита (type plain).
 *
 * Визуал — нативный (поверхность/тень/радиус кита). Паддинги variant —
 * косметика внутри кита (токены --app-card-*). Раскладка остаётся
 * у вызывающего.
 *
 * Исключение: интерактивные контейнеры (Tappable-кнопка ленты) и
 * Skeleton-болванки не могут быть article — там CARD_SURFACE из
 * ui/classes.ts поверх нативного компонента (см. комментарий там).
 */
export function Card({
  variant = "default",
  className,
  children,
  ...restProps
}: CardProps) {
  const variantClass = VARIANTS[variant];
  return (
    <TguiCard
      type="plain"
      className={[variantClass, className].filter(Boolean).join(" ") || undefined}
      {...restProps}
    >
      {children}
    </TguiCard>
  );
}
