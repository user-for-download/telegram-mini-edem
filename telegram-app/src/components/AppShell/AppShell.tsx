import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

/** Класс route-fade живёт в CSS-модуле AppShell (хэшируется сборкой). */
export const ROUTE_FADE_CLASS = styles["route-fade"];

export interface AppShellProps {
  /** Шапка корневых разделов (AppHeader) — только на табах. */
  header?: ReactNode;
  /** Контент маршрута (Outlet в route-fade обёртке у роутера). */
  children: ReactNode;
  /** Нижний бар (AppBottomBar: nav-landmark + нативный Tabbar). */
  footer?: ReactNode;
}

/**
 * Колонка приложения (стили — AppShell.module.css рядом).
 * Main — фокусируемый landmark (tabIndex -1) для возврата фокуса
 * после Back из модалки; data-shell-content — стабильный хук для
 * useScrollRestore (классы модуля хэшируются, селектор по классу
 * был бы хрупким).
 */
export function AppShell({ header, children, footer }: AppShellProps) {
  return (
    <div className={styles.shell}>
      {header}
      <main className={styles.content} data-shell-content tabIndex={-1}>
        {children}
      </main>
      {footer}
    </div>
  );
}
