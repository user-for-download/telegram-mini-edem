import type { HTMLAttributes, ReactNode } from "react";

/* Единая поверхность карточек лент (фаза 2 унификации секций):
 * поездка, уведомление, отзыв, бронь, заявка, жалоба — один рецепт
 * вместо копипасты rounded-2xl/border/shadow по ~15 местам.
 * Раскладка (p-4/p-3.5, flex, gap) остаётся у вызывающих.
 * Интерактивные карточки (Tappable) используют FEED_CARD_SURFACE.
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
