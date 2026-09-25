import type { ReactNode } from "react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
import styles from "./StatusPill.module.css";

export type StatusTone = "warning" | "danger" | "info" | "success";

export interface StatusPillProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

/**
 * Статус-пилюля на нативном `Chip` кита (mode mono, Component span).
 * Тон — data-tone + --app-* токены (StatusPill.module.css): смысл всегда
 * дублируется текстом, не только цветом (a11y: color + text).
 */
export function StatusPill({ tone, className = "", children }: StatusPillProps) {
  const merged = className ? `${styles.pill} ${className}` : styles.pill;
  return (
    <TguiChip Component="span" mode="mono" data-tone={tone} className={merged}>
      {children}
    </TguiChip>
  );
}
