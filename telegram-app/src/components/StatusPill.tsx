import type { ReactNode } from "react";

export type StatusTone = "warning" | "danger" | "info" | "success";

export interface StatusPillProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

/**
 * Статус-пилюля на .StatusPill-токенах (index.css, untouched).
 * Смысл всегда дублируется текстом, не только цветом (a11y: color + text).
 */
export function StatusPill({ tone, className = "", children }: StatusPillProps) {
  return (
    <span className={`StatusPill ${className}`.trim()} data-tone={tone}>
      {children}
    </span>
  );
}
