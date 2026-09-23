import type { HTMLAttributes, ReactNode } from "react";
import styles from "./FeedCard.module.css";

/* Единая поверхность карточек лент переезжала в ui/Card (фаза 01):
 * рецепт больше не дублируется ни строкой, ни модулем — источник один
 * (ui/ui.module.css + токены --app-card-* в index.css).
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
 * Решение: оставить div-рецепт (теперь — ui/Card), нулевой риск
 * визуальной регрессии.
 */
export function FeedCard({
  className = "",
  children,
  ...restProps
}: {
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${styles.card} ${className}`.trim()} {...restProps}>
      {children}
    </div>
  );
}
