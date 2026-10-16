import { useState } from "react";
import type { MouseEvent } from "react";

import { Button } from "@/ui/Button";
import type { ButtonVariant } from "@/ui/Button";
import { popup } from "@tma.js/sdk-react";
import { isTelegramMockEnv } from "@/utils/telegram-adapter";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import styles from "./ConfirmPopup.module.css";

/** Публичный параметр mode (совместимость с прежними вызовами) → variant. */
const CONFIRM_MODE_VARIANT = {
  filled: "primary",
  bezeled: "secondary",
  plain: "ghost",
  outline: "outline",
  white: "white",
} as const satisfies Record<string, ButtonVariant>;

export type ConfirmMode = keyof typeof CONFIRM_MODE_VARIANT;

/**
 * Confirm-guard через нативный popup клиента (как AlertController
 * официального клиента: заголовок + текст последствий + [Отмена |
 * красная деструктивная]).
 *
 * ГДЕ ЧТО ПОКАЗЫВАЕТСЯ:
 * - Telegram, popup доступен → нативный алерт клиента. Эта ветка не
 *   менялась и не меняется: выбор делает `popup.show.isAvailable()`.
 * - Браузер (dev-стенд), popup недоступен → ConfirmSheet на китовом Sheet.
 * - Telegram для macOS (mockTelegramEnv): SDK врёт `isAvailable() === true`,
 *   а показать нечем → тоже ConfirmSheet.
 *
 * Про macOS важно: до этого мок-ветка выполняла деструктивное действие
 * СРАЗУ, вообще без подтверждения — «Удалить профиль» на macOS удалял
 * аккаунт одним тапом. Теперь там тот же Sheet, что и на стенде.
 *
 * Маппинг (лимиты нативного popup: title ≤64, message ≤256, ≤3 кнопок):
 * title/text кнопки = confirmLabel, message = description, системная
 * Cancel + destructive/default confirm. Закрытие без выбора (null) —
 * отмена. Popup закрывается по тапу: pending мутации держит disabled
 * на триггере, дабл-сабмит гасится вызывающим кодом через pending.
 * mode (все режимы кита: filled/bezeled/plain/outline/white)
 * СОВМЕСТИМ: внутри маппится на variant ui/Button через
 * CONFIRM_MODE_VARIANT — вызывающие код не меняли.
 */
export function ConfirmPopup({
  label,
  confirmLabel,
  description,
  pending = false,
  mode = "bezeled",
  disabled = false,
  destructive = false,
  className,
  nested = false,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  pending?: boolean;
  mode?: ConfirmMode;
  disabled?: boolean;
  destructive?: boolean;
  /** Класс на кнопку-триггер (нативный MIN_TARGET). */
  className?: string;
  /**
   * Триггер лежит ВНУТРИ открытой шторки — ConfirmSheet поднимается как
   * вложенный корень (см. ConfirmSheet). Ставится вызывающим, который
   * знает, что он нарисован в содержимом шторки: тот же ConfirmPopup на
   * странице вложенным быть не может.
   */
  nested?: boolean;
  onConfirm: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const stop = (event: MouseEvent) => event.stopPropagation();

  // Деструктивный цвет — классом модуля, не инлайном (канон: цвета только
  // из токена/модуля; инверсия light/dark — в index.css).
  const triggerClassName =
    [className, destructive ? styles.destructive : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  const openSheet = () => setSheetOpen(true);

  return (
    <>
      <Button
        variant={CONFIRM_MODE_VARIANT[mode]}
        size="s"
        stretched
        disabled={disabled || pending}
        className={triggerClassName}
        onClick={(event) => {
          stop(event);
          // Мок-окружение (Telegram macOS): нативный popup недоступен,
          // несмотря на isAvailable() === true. Проверяем ДО вызова popup,
          // иначе он зависнет на неразрешённом промисе.
          if (isTelegramMockEnv()) {
            openSheet();
            return;
          }
          void (async () => {
            // ifAvailable отдаёт кортеж [called, promise], а не значение —
            // поэтому явная проверка isAvailable() + прямой вызов show(),
            // резолвящий buttonId (null = закрыт без выбора = отмена).
            try {
              if (!popup.show.isAvailable()) {
                openSheet();
                return;
              }
              const buttonId = await popup.show({
                title: confirmLabel,
                message: description,
                buttons: [
                  { id: "cancel", type: "cancel" },
                  {
                    id: "confirm",
                    type: destructive ? "destructive" : "default",
                    text: confirmLabel,
                  },
                ],
              });
              if (buttonId === "confirm") {
                onConfirm();
              }
            } catch {
              openSheet();
            }
          })();
        }}
      >
        {label}
      </Button>
      <ConfirmSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        confirmLabel={confirmLabel}
        description={description}
        pending={pending}
        destructive={destructive}
        nested={nested}
        onConfirm={() => {
          setSheetOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
