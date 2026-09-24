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
 * TGUI Card visual-check (2026-09-15, tgui-adoption-04): STOP — миграция
 * на `Card` из @telegram-apps/telegram-ui (v2.1.13) отклонена, расхождения
 * по всем пунктам (dist/styles.css как источник истины):
 * - radius: Card 20px vs rounded-2xl (16px)
 * - border: у Card нет рамки vs hairline --tgui--outline
 * - bg: Card tertiary_bg_color (#f4f4f7) vs section_bg_color (#fff)
 * - shadow: Card 0 32px 64px + 0 0 2px vs shadow-xs
 * - layout: Card display:inline-block + overflow:hidden, рендерит <article>
 *   (не <div>) — ломает блочную раскладку ленты
 * - Card.Cell оборачивает в интерактивный Cell (padding 0 20px) —
 *   конфликтует с системой паддингов; `readOnly` в CellProps нет
 * - Card.Chip position:absolute — ломает инлайн-пилюлю мест
 * Решение: только div-рецепт (этот примитив), нулевой риск регрессии.
 *
 * Раскладка (gap/flex/вид строки) остаётся у вызывающего: он докладывает
 * свой className, как и раньше у FeedCard. Для контейнеров, которые нельзя
 * сделать div (Tappable/button/китовая обёртка), есть класс-константы в
 * ui/classes.ts — правило то же, контейнер любой.
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
