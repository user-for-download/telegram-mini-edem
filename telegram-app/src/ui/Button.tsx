import type { ComponentProps } from "react";
import { Button as TguiButton } from "@telegram-apps/telegram-ui";

/**
 * Смысловые варианты кнопки → режимы кита (маппинг 1:1: визуально ничего
 * не меняем, но выбор «какая это кнопка» перестаёт быть выбором mode).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";

const MODES = {
  primary: "filled",
  secondary: "bezeled",
  ghost: "plain",
  outline: "outline",
} as const;

export interface ButtonProps
  extends Omit<ComponentProps<typeof TguiButton>, "mode"> {
  /**
   * primary — главное действие экрана/диалога (1–2 на экран);
   * secondary (по умолчанию) — обычное действие;
   * ghost — «тихая» кнопка-ссылка;
   * outline — действие с рамкой (тихие переходы, чипы-кнопки).
   */
  variant?: ButtonVariant;
}

/**
 * Единая кнопка приложения (сессия .tmp/sessions/2026-09-23-ui-common-kit).
 *
 * Гарантия тап-таргета: `min-h-11` (44px, WCAG 2.5.8) ставится ВСЕГДА —
 * раньше это делали руками в 6 файлах (21 место), а у `size="s"` кит даёт
 * ~36px, т.е. часть кнопок была ниже нормы. Строка `min-h-11` сохраняется
 * в HTML — 4 теста ассертят её как контракт.
 *
 * Все остальные пропсы кита (size, stretched, loading, disabled, before,
 * Component, type, ref) прокидываются без изменений.
 *
 * Деструктив — НЕ вариант кнопки: красные действия идут через
 * ConfirmPopup/ConfirmAction (`mode="plain"` + `destructive`), чтобы
 * опасное действие всегда было под подтверждением.
 */
export function Button({
  variant = "secondary",
  className,
  ...restProps
}: ButtonProps) {
  return (
    <TguiButton
      mode={MODES[variant]}
      className={className ? `min-h-11 ${className}` : "min-h-11"}
      {...restProps}
    />
  );
}
