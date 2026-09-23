import type { ReactNode } from "react";
import styles from "./ui.module.css";

export interface SectionBodyProps {
  children: ReactNode;
  className?: string;
}

/**
 * Тело секции внутри tgui `<Section>`: паддинг 16 и ритм 12 из токенов.
 *
 * Заменяет семь дословных копий `.panel`/`.filtersBody`/`.faqPanel`
 * (Notifications/Support/CreateTrip/Profile/Settings/Reports/Search).
 * Ставится 1:1 вместо `<div className={styles.panel}>` — сам `<Section>`
 * остаётся китовым (заголовок, подвал, `Divider` между детьми), тело
 * бандлится в ОДИН ребёнок, поэтому лишних разделителей не появляется.
 *
 * Это обычный div, а не List: внутри секции List добавлял бы только
 * платформенный паддинг (iOS 10px/18px), который всё равно перекрывается,
 * и подменял бы наш токен ритма китовым значением. List — только корень
 * экрана (см. Page).
 */
export function SectionBody({ children, className }: SectionBodyProps) {
  return (
    <div className={className ? `${styles.sectionBody} ${className}` : styles.sectionBody}>
      {children}
    </div>
  );
}
