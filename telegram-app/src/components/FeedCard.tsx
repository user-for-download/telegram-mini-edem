import type { HTMLAttributes, ReactNode } from "react";

/* Единая поверхность карточек лент (фаза 2 унификации секций):
 * поездка, уведомление, отзыв, бронь, заявка, жалоба — один рецепт
 * вместо копипасты rounded-2xl/border/shadow по ~15 местам.
 * Раскладка (p-4/p-3.5, flex, gap) остаётся у вызывающих.
 * Интерактивные карточки (Tappable) используют FEED_CARD_SURFACE.
 *
 * TGUI Card visual-check (2026-09-15, tgui-adoption-04): STOP — миграция
 * на `Card` из @telegram-apps/telegram-ui (v2.1.13) отклонена, расхождения
 * по всем пунктам (dist/styles.css как источник истины):
 * - radius: Card 20px vs rounded-2xl (16px)
 * - border: у Card нет рамки vs border-(--tgui--outline)
 * - bg: Card tertiary_bg_color (#f4f4f7) vs section_bg_color (#fff)
 * - shadow: Card 0 32px 64px + 0 0 2px vs shadow-xs
 * - layout: Card display:inline-block + overflow:hidden, рендерит <article>
 *   (не <div>) — ломает блочную раскладку ленты из 11 мест использования
 * - Card.Cell оборачивает в интерактивный Cell (padding 0 20px, children
 *   в span с accent-weight, subtitle clamp 2) — конфликтует с p-4/p-3.5
 *   системой и вложенностью в Tappable; `readOnly` в CellProps нет
 *   (TappableProps его не содержит) — утек бы в DOM
 * - Card.Chip position:absolute (right/top 16px) — ломает инлайн-пилюлю мест
 * Решение: оставить div-рецепт, нулевой риск визуальной регрессии.
 */
export const FEED_CARD_SURFACE =
  "rounded-2xl border border-(--tgui--outline) bg-(--tgui--section_bg_color) shadow-xs";

export function FeedCard({
  className = "",
  children,
  ...restProps
}: {
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${FEED_CARD_SURFACE} ${className}`.trim()} {...restProps}>
      {children}
    </div>
  );
}
