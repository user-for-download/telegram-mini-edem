import type { ComponentProps, ReactNode } from "react";
import { Card as TguiCard } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

export interface CardProps
  extends Omit<ComponentProps<typeof TguiCard>, "type"> {
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
 * Единая карточка приложения на нативном `Card` кита.
 *
 * Тип зафиксирован — `plain` (дефолт кита): consumer не выбирает `type`,
 * поэтому он и исключён из пропсов. Остальное (включая `ref`, HTML-атрибуты
 * и композицию `Card.Cell` / `Card.Chip`) — контракт кита 1:1; типизация
 * через `ComponentProps`, как у ui/Button, ui/Chip, ui/IconButton.
 *
 * Визуал — НЕ нативный: рецепт приложения (radius 16 вместо 20, наша
 * xs-тень и фон секции — см. ui.module.css .card.card и «Реестр отклонений»
 * в ui/README.md). Гарантия бокса — тоже здесь: карточка всегда на всю
 * ширину родителя, потребитель владеет только внутренней раскладкой.
 *
 * Исключение: интерактивные контейнеры (Tappable-кнопка ленты) и
 * Skeleton-болванки не могут быть article — там CARD_SURFACE из
 * ui/classes.ts поверх нативного компонента (см. комментарий там).
 */
function CardRoot({
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

export const Card = Object.assign(CardRoot, {
  /** Ячейка-композиция кита (Card.Cell) — без выхода за фасад. */
  Cell: TguiCard.Cell,
  /** Чип-композиция кита (Card.Chip) — без выхода за фасад. */
  Chip: TguiCard.Chip,
});
