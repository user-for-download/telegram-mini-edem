import type { ReactNode } from "react";
import { List } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

export type PageVariant = "scroll" | "hero";

export interface PageProps {
  /**
   * Блоки экрана. Вертикальный ритм между ними даёт кит
   * (`List > :not(:last-child) { margin-bottom: 12px }`) — свой gap не
   * нужен и запрещён: ритм удвоился бы.
   */
  children: ReactNode;
  /** Доп. класс — только для нестандартной раскладки конкретной страницы. */
  className?: string;
  /**
   * scroll (по умолчанию) — обычный экран: контент сверху, ритм 12.
   *
   * hero — первый экран (приветствие/онбординг): лист растянут на всю
   * высоту вьюпорта, группа детей центрирована по вертикали, низ — только
   * безопасная врезка (дока таббара на таком экране нет).
   *
   * hero существует РОВНО для того, чтобы первый экран не собирал корень
   * руками: сырой `<List>` в обход Page не гасит платформенный паддинг кита
   * (на iOS `padding: 10px 18px`) и на Android получает нулевой гуттер —
   * экран выглядел по-разному на платформах (см. ui/README.md).
   */
  variant?: PageVariant;
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
 * - низ — `--app-page-pad-bottom` (высота дока таббара + зазор + нижняя
 *   safe-area): владеется ТОЛЬКО здесь, AppShell.content клиренс не
 *   дублирует, иначе получалось 192px.
 */
export function Page({ children, className, variant = "scroll" }: PageProps) {
  const classes = [
    styles.page,
    variant === "hero" ? styles.pageHero : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <List className={classes}>{children}</List>;
}
