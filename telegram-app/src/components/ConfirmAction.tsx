import { useId, useState } from "react";
import { Button, Text } from "@telegram-apps/telegram-ui";

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
  destructive = false,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  pending?: boolean;
  mode?: "bezeled" | "plain";
  disabled?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const descId = useId();
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        mode={mode}
        size="s"
        stretched
        disabled={disabled || pending}
        style={
          destructive
            ? { color: "var(--tgui--destructive_text_color)" }
            : undefined
        }
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label={label}
      aria-describedby={descId}
    >
      <Text Component="p" id={descId}>
        {description}
      </Text>
      <div className="flex flex-col gap-2 mt-2">
        {/* Подтверждение деструктива — всегда filled: иначе неотличимо
            от «Назад» (исключение из правила «всё bezeled»). */}
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
        <Button
          mode="bezeled"
          size="s"
          stretched
          disabled={pending}
          onClick={() => setArmed(false)}
        >
          Назад
        </Button>
      </div>
    </div>
  );
}
