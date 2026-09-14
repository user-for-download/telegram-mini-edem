import type { ReactNode } from "react";
import { Button, Placeholder } from "@telegram-apps/telegram-ui";

export function AccountStatePage({
  title,
  description,
  action,
}: { title: string; description: string; action?: ReactNode }) {
  return <main className="AccountState" aria-live="polite"><Placeholder header={title} description={description} action={action} /></main>;
}

export function RetryAction({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <Button mode="bezeled" size="l" stretched disabled={disabled} onClick={onClick}>{label}</Button>;
}
