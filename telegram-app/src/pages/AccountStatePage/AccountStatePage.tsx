import type { ReactNode } from "react";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";

import styles from "./AccountStatePage.module.css";

/**
 * Терминальный экран аккаунта (бан/удаление/ошибка сессии): корень —
 * Page из кита, пустое состояние — EmptyState (были main.root +
 * голый Placeholder). Центрированная колонка и aria-live живут на
 * внутреннем боксе (styles.root) — Page отвечает только за каркас.
 */

export function AccountStatePage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Page>
      <div className={styles.root} aria-live="polite">
        <EmptyState header={title} description={description} action={action} />
      </div>
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
