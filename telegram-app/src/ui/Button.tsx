import type { ComponentProps } from "react";
import { Button as TguiButton } from "@telegram-apps/telegram-ui";
import { MIN_TARGET } from "@/ui/classes";

/**
 * Смысловые варианты кнопки → режимы кита (маппинг 1:1: визуально ничего
 * не меняем, но выбор «какая это кнопка» перестаёт быть выбором mode).
 */
export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "outline" | "white";

const MODES = {
  primary: "filled",
  secondary: "bezeled",
  ghost: "plain",
  outline: "outline",
  white: "white",
} as const;

export interface ButtonProps extends Omit<
  ComponentProps<typeof TguiButton>,
  "mode"
> {
  /**
   * primary — главное действие экрана/диалога (1–2 на экран);
   * secondary (по умолчанию) — обычное действие;
   * ghost — «тихая» кнопка-ссылка;
   * outline — действие с рамкой (тихие переходы, чипы-кнопки);
   * white — белая кнопка на тонированной поверхности.
   */
  variant?: ButtonVariant;
}

/**
 * Единая кнопка приложения.
 *
 * Гарантия тап-таргета: MIN_TARGET (44px, WCAG 2.5.5 AAA) ставится для
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
  // Нативный кит: тап-таргет 44px (WCAG 2.5.5 AAA) — только хэш-класс MIN_TARGET
  // для размеров m/l. Проверка на undefined — для TS (CSS-модули типизированы
  // как string | undefined).
  const minH = size === "s" ? undefined : MIN_TARGET;
  // Явный MIN_TARGET в className (компактные size="s" в модалках) тоже
  // считается: data-атрибут ниже — стабильный хук для SSR-тестов вместо
  // строки класса.
  const hasMinTarget =
    Boolean(minH) ||
    (typeof className === "string" &&
      MIN_TARGET !== undefined &&
      className.includes(MIN_TARGET));
  return (
    <TguiButton
      mode={MODES[variant]}
      size={size}
      data-tap-target={hasMinTarget ? "44" : undefined}
      className={[minH, className].filter(Boolean).join(" ") || undefined}
      {...restProps}
    />
  );
}
