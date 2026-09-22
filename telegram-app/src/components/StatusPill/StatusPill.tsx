import type { ReactNode } from "react";
import styles from "./StatusPill.module.css";

export type StatusTone = "warning" | "danger" | "info" | "success";

export interface StatusPillProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

/**
 * Статус-пилюля на --app-* токенах (StatusPill.module.css рядом).
 * Смысл всегда дублируется текстом, не только цветом (a11y: color + text).
 */
export function StatusPill({ tone, className = "", children }: StatusPillProps) {
  const merged = className ? `${styles.pill} ${className}` : styles.pill;
  return (
    <span className={merged} data-tone={tone}>
      {children}
    </span>
  );
}
