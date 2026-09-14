import { useState } from "react";
import { Button } from "@telegram-apps/telegram-ui";

/**
 * Confirm-guard для деструктивных действий (паритет VK ConfirmProvider):
 * первый клик «вооружает» кнопку, второй — выполняет. Отмена снимает
 * armed-состояние. Двойной сабмит блокируется через pending.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  description,
  pending = false,
  mode = "bezeled",
  disabled = false,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  pending?: boolean;
  mode?: "bezeled" | "plain";
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        mode={mode}
        size="s"
        stretched
        disabled={disabled || pending}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label={label} aria-describedby="confirm-action-desc">
      <p id="confirm-action-desc">{description}</p>
      <div className="ButtonRow">
        <Button
          mode="filled"
          size="s"
          stretched
          loading={pending}
          disabled={pending}
          onClick={() => {
            onConfirm();
            setArmed(false);
          }}
        >
          {confirmLabel}
        </Button>
        <Button mode="bezeled" size="s" stretched disabled={pending} onClick={() => setArmed(false)}>
          Назад
        </Button>
      </div>
    </div>
  );
}
