import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Text } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";


/**
 * Confirm-guard для деструктивных действий:
 * первый клик «вооружает» кнопку, второй — выполняет. Отмена снимает
 * armed-состояние. Двойной сабмит блокируется через pending.
 *
 * a11y: триггер НЕ размонтируется при armed (иначе фокус падает на body
 * и клавиатурный пользователь теряет место). Armed-панель — описанная
 * через aria-describedby область с переносом фокуса на кнопку
 * подтверждения и возвратом фокуса на триггер при «Назад».
 *
 * actionsEnd — кнопки панели прижать к правому краю (компактные,
 * вместо stretch на всю ширину): для футеров карточек, где триггер
 * уже у правого края.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  description,
  pending = false,
  mode = "bezeled",
  disabled = false,
  destructive = false,
  actionsEnd = false,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  pending?: boolean;
  mode?: "bezeled" | "plain";
  disabled?: boolean;
  destructive?: boolean;
  actionsEnd?: boolean;
  onConfirm: () => void;
}) {
  const descId = useId();
  const [armed, setArmed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // Фокус был уведён внутрь панели — при разоружении вернуть на триггер.
  const movedFocusRef = useRef(false);

  useEffect(() => {
    if (armed) {
      movedFocusRef.current = true;
      confirmRef.current?.focus();
    } else if (movedFocusRef.current) {
      movedFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [armed]);

  // Клики гасим на месте: ConfirmAction часто живёт внутри кликабельных
  // карточек (TripCard, DriverTripRequests) — всплытие открыло бы детали
  // поверх деструктива. Отдельные stopPropagation-обёртки вокруг компонента
  // запрещены jsx-a11y (интерактив оборачивать нельзя — чиним здесь).
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div>
      <Button
        ref={triggerRef}
        // Наш ui/Button говорит на языке variant; публичный mode-параметр
        // ConfirmAction оставлен совместимым с прежними вызовами (bezeled|plain).
        variant={mode === "plain" ? "ghost" : "secondary"}
        size="s"
        stretched
        disabled={disabled || pending}
        aria-expanded={armed}
        aria-describedby={armed ? descId : undefined}
        style={
          destructive
            ? { color: "var(--tgui--destructive_text_color)" }
            : undefined
        }
        onClick={(event) => {
          stop(event);
          setArmed(true);
        }}
      >
        {label}
      </Button>
      {armed && (
        <div className={`flex flex-col gap-2 mt-2${actionsEnd ? " items-end" : ""}`}>
          <Text Component="p" id={descId}>
            {description}
          </Text>
          {/* Подтверждение деструктива — всегда filled: иначе неотличимо
              от «Назад» (исключение из правила «всё bezeled»). */}
          <Button
            ref={confirmRef}
            variant="primary"
            size="s"
            stretched
            loading={pending}
            disabled={pending}
            onClick={(event) => {
              stop(event);
              onConfirm();
              setArmed(false);
            }}
          >
            {confirmLabel}
          </Button>
          <Button
            size="s"
            stretched
            disabled={pending}
            onClick={(event) => {
              stop(event);
              setArmed(false);
            }}
          >
            Назад
          </Button>
        </div>
      )}
    </div>
  );
}
