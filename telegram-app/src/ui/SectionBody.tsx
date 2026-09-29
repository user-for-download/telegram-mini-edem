import type { HTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export interface SectionBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * Тело секции внутри tgui `<Section>`: паддинг 16 и ритм 12 из токенов.
 *
 * Заменяет семь дословных копий локальных `.panel`/`.filtersBody`/`.faqPanel`
 * (Notifications/Support/CreateTrip/Profile/Reports/Search).
 * Ставится 1:1 вместо прежнего `<div className={…panel}>` — сам `<Section>`
 * остаётся китовым (заголовок, подвал, `Divider` между детьми), тело
 * бандлится в ОДИН ребёнок, поэтому лишних разделителей не появляется.
 *
 * Это обычный div, а не List: внутри секции List добавлял бы только
 * платформенный паддинг (iOS 10px/18px), который всё равно перекрывается,
 * и подменял бы наш токен ритма китовым значением. List — только корень
 * экрана (см. Page).
 *
 * Пропсы обычного div (`id`, `aria-*`, `data-*`, `ref`) прокидываются как
 * есть — как у ui/Stack и ui/Notice.
 */
export function SectionBody({
  children,
  className,
  ...rest
}: SectionBodyProps) {
  return (
    <div
      className={[styles.sectionBody, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
