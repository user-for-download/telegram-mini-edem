import type { ReactNode } from "react";
import { List } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

export interface PageProps {
  /**
   * Блоки экрана. Вертикальный ритм между ними даёт кит
   * (`List > :not(:last-child) { margin-bottom: 12px }`) — свой gap не
   * нужен и запрещён: ритм удвоился бы.
   */
  children: ReactNode;
  /** Доп. класс — только для нестандартной раскладки конкретной страницы. */
  className?: string;
}

/**
 * Корень экрана: единственный разрешённый контейнер верхнего уровня для
 * всех страниц (универсальный каркас, см. ui.module.css).
 *
 * Корень — именно tgui List, поэтому:
 * - вертикальный ритм 12px одинаков на всех экранах (одно правило кита);
 * - платформенный паддинг List (на iOS кит добавляет `padding: 10px 18px`)
 *   гасится нашим неслойным модулем — Android и iOS выглядят одинаково
 *   (раньше TripPage жил на голом `<List>` и на iOS получал бока 18px);
 * - бока 16px и верх 4px приходят из токенов `--app-page-*`;
 * - низ 96px (клиренс под док таббара) владеется ТОЛЬКО здесь —
 *   AppShell.content клиренс больше не дублирует, иначе получалось 192px.
 */
export function Page({ children, className }: PageProps) {
  return (
    <List className={className ? `${styles.page} ${className}` : styles.page}>
      {children}
    </List>
  );
}
