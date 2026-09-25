import { useState } from "react";
import type { MouseEvent } from "react";

import { Button } from "@/ui/Button";
import { popup } from "@telegram-apps/sdk-react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { isTelegramMockEnv } from "@/utils/telegram-adapter";
import styles from "./ConfirmAction.module.css";

/**
 * Confirm-guard через нативный popup клиента (как AlertController
 * официального клиента: заголовок + текст последствий + [Отмена |
 * красная деструктивная]). Вне Telegram (dev-браузер) popup недоступен —
 * молча откатываемся на инлайн ConfirmAction (тот же API пропсов).
 * NB: под mockTelegramEnv (dev) isAvailable() врёт (true), а диалога
 * мок показать не может. Браузер — среда разработки: подтверждения
 * там не нужны, кнопка выполняет действие сразу, без панели
 * (см. isTelegramMockEnv). Инлайн ConfirmAction остаётся фолбэком
 * только для реальных клиентов без popup (старые версии).
 *
 * Маппинг (лимиты нативного popup: title ≤64, message ≤256, ≤3 кнопок):
 * title/text кнопки = confirmLabel, message = description, системная
 * Cancel + destructive/default confirm. Закрытие без выбора (null) —
 * отмена. Popup закрывается по тапу: pending мутации держит disabled
 * на триггере, дабл-сабмит гасится вызывающим кодом через pending.
 * mode (bezeled|plain, китовый) СОВМЕСТИМ: внутри маппится на variant
 * ui/Button (secondary|ghost) — вызывающие код не меняли.
 */
export function ConfirmPopup({
  label,
  confirmLabel,
  description,
  pending = false,
  mode = "bezeled",
  disabled = false,
  destructive = false,
  actionsEnd = false,
  className,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  pending?: boolean;
  mode?: "bezeled" | "plain";
  disabled?: boolean;
  destructive?: boolean;
  /** Инлайн-фолбэк: кнопки панели к правому краю (см. ConfirmAction). */
  actionsEnd?: boolean;
  /** Класс на кнопку-триггер (например, min-h-11); фолбэк-панель — без него. */
  className?: string;
  onConfirm: () => void;
}) {
  const [fallback, setFallback] = useState(false);

  const stop = (event: MouseEvent) => event.stopPropagation();

  // Деструктивный цвет — классом модуля, не инлайном (канон: цвета только
  // из токена/модуля; инверсия light/dark — в index.css).
  const triggerClassName =
    [className, destructive ? styles.destructive : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  // Мок-окружение (dev-браузер): браузер — среда разработки,
  // подтверждения не нужны — кнопка выполняет действие сразу.
  if (isTelegramMockEnv()) {
    return (
      <Button
        variant={mode === "plain" ? "ghost" : "secondary"}
        size="s"
        stretched
        disabled={disabled || pending}
        className={triggerClassName}
        onClick={(event) => {
          stop(event);
          onConfirm();
        }}
      >
        {label}
      </Button>
    );
  }

  if (fallback) {
    return (
      <ConfirmAction
        label={label}
        confirmLabel={confirmLabel}
        description={description}
        pending={pending}
        mode={mode}
        disabled={disabled}
        destructive={destructive}
        actionsEnd={actionsEnd}
        onConfirm={onConfirm}
      />
    );
  }

  return (
    <Button
      variant={mode === "plain" ? "ghost" : "secondary"}
      size="s"
      stretched
      disabled={disabled || pending}
      className={triggerClassName}
      onClick={(event) => {
        stop(event);
        void (async () => {
          // ifAvailable отдаёт кортеж [called, promise], а не значение —
          // поэтому явная проверка isAvailable() + прямой вызов show(),
          // резолвящий buttonId (null = закрыт без выбора = отмена).
          try {
            if (!popup.show.isAvailable()) {
              setFallback(true);
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
            setFallback(true);
          }
        })();
      }}
    >
      {label}
    </Button>
  );
}
