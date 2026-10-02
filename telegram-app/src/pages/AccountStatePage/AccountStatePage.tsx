import type { ReactNode } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";

import styles from "./AccountStatePage.module.css";

/**
 * Терминальный экран аккаунта (бан/удаление/ошибка сессии): корень —
 * Page из кита, пустое состояние — EmptyState (были main.root +
 * голый Placeholder). Центрированная колонка и aria-live живут на
 * внутреннем боксе (styles.root) — Page отвечает только за каркас.
 *
 * children — блок ПОД пустым состоянием (форма обжалования бана). Он
 * рендерится внутри Page намеренно: у Section свой гуттер есть только
 * от Page, снаружи секция встаёт во всю ширину (0px) — на iOS это
 * другая рамка, чем у всех остальных секций приложения.
 *
 * Скрытый h1 — имя терминального состояния: EmptyState идёт через
 * Placeholder, а тот рендерит заголовок как <dt> (имя экрана без
 * heading-семантики). Видимую разметку не трогаем.
 */

export function AccountStatePage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Page>
      <VisuallyHidden Component="h1">{title}</VisuallyHidden>
      <div className={styles.root} aria-live="polite">
        <EmptyState header={title} description={description} action={action} />
      </div>
      {children}
    </Page>
  );
}

export function RetryAction({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="l"
      stretched
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
