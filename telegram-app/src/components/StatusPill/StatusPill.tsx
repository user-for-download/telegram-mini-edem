import type { ReactNode } from "react";
import { Badge } from "@telegram-apps/telegram-ui";
import styles from "./StatusPill.module.css";

export type StatusTone = "warning" | "danger" | "info" | "success";

export interface StatusPillProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

/**
 * Статус-пилюля на нативном `Badge` кита: геометрию и типографику
 * (radius 20, высота 20, Caption 13/600) даёт кит, мы не дублируем.
 *
 * Тон — data-tone + --app-* токены (StatusPill.module.css), которые
 * указывают на палитру кита (--tgui--green/link/destructive, warning —
 * --tgui--hint_color). Родной mode-цвет Badge перебиваем: у mode нет
 * success/warning, а нам нужны 4 различимых тона.
 *
 * a11y: смысл всегда дублируется текстом, не только цветом (color + text).
 */
export function StatusPill({
  tone,
  className = "",
  children,
}: StatusPillProps) {
  const merged = [styles.pill, className].filter(Boolean).join(" ");
  return (
    <Badge type="number" mode="secondary" data-tone={tone} className={merged}>
      {children}
    </Badge>
  );
}
