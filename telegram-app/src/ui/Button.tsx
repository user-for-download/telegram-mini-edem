import type { ComponentProps } from "react";
import { Button as TguiButton } from "@telegram-apps/telegram-ui";
import { MIN_TARGET } from "@/ui/classes";

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
 * Гарантия тап-таргета: MIN_TARGET (44px, WCAG 2.5.8) ставится для
 * размеров m/l — раньше это делали руками в 6 файлах (21 место).
 * `size="s"` — компактный контекст (чипы, строки заявок): min-h не
 * навязываем, высота нативная у кита (~36px).
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
  size,
  className,
  ...restProps
}: ButtonProps) {
  // Tailwind decommission: hashed MIN_TARGET carries the style, literal
  // `min-h-11` keeps SSR assertions (button/modals/reports tests) stable.
  // Глобальный .minTarget44 в index.css — читаемая строка-имя того же 44px
  // (без Tailwind-префлайта): хэш несёт стиль, литералы держат ассерты.
  const minH = size === "s" ? undefined : `${MIN_TARGET} min-h-11 minTarget44`;
  return (
    <TguiButton
      mode={MODES[variant]}
      size={size}
      className={[minH, className].filter(Boolean).join(" ") || undefined}
      {...restProps}
    />
  );
}
