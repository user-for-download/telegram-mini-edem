import type { HTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * default — паддинг 16 (основная поверхность лент и секций);
   * compact — 12 (плотные вложенные боксы);
   * flush — 0 (тело держит раскладку само).
   */
  variant?: "default" | "compact" | "flush";
  children: ReactNode;
}

const VARIANTS = {
  default: styles.cardDefault,
  compact: styles.cardCompact,
  flush: styles.cardFlush,
} as const;

/**
 * Единая поверхность карточки (фаза 01 унификации UI, сессия
 * .tmp/sessions/2026-09-23-ui-unification).
 *
 * Рецепт побайт прежнего FeedCard (radius 16, hairline --tgui--outline,
 * shadow-xs, --tgui--section_bg_color), но источник ОДИН — этот класс и
 * токены --app-card-* в index.css; ранее тот же рецепт жил ~11 копиями
 * по модулям (ProfileModals ×3, TripModals ×2, TripFeedCard, TripCards,
 * CreateTrip, ProfilePage, SearchPage, FeedCard).
 *
 * kit <Card> из @telegram-apps/telegram-ui НЕ используем: visual-check
 * tgui-adoption-04 отклонил его (radius 20 vs 16, нет рамки, bg
 * tertiary вместо section, тень 0 32px, display:inline-block, конфликт
 * Card.Cell/Card.Chip) — аргументы зафиксированы в FeedCard.tsx.
 *
 * Раскладка (gap/flex/вид строки) остаётся у вызывающего: он докладывает
 * свой className, как и раньше у FeedCard.
 */
export function Card({
  variant = "default",
  className,
  children,
  ...restProps
}: CardProps) {
  const variantClass = VARIANTS[variant];
  return (
    <div
      className={[styles.card, variantClass, className]
        .filter(Boolean)
        .join(" ")}
      {...restProps}
    >
      {children}
    </div>
  );
}
