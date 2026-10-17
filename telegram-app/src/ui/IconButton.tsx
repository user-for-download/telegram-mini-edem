import type { ComponentProps } from "react";
import { IconButton as TguiIconButton } from "@telegram-apps/telegram-ui";

/**
 * Смысловые варианты иконкной кнопки → режимы кита (маппинг 1:1, как у
 * `ui/Button`): выбор «какая это кнопка» перестаёт быть выбором `mode`.
 *
 * - `secondary` (bezeled) — обычная кнопка-действие;
 * - `ghost` (plain, по умолчанию) — «тихая» иконка в строке;
 * - `gray` — приглушённая заливка без акцента (тот же режим кита и тот же
 *   смысл, что `variant="gray"` у текстовой `ui/Button`: одно слово на одну
 *   роль);
 * - `outline` (outline) — контурная кнопка без заливки: нейтральное кольцо
 *   вокруг иконки. Деструктивные действия («Отклонить заявку») и вторичные
 *   иконки рядом с outline-кнопкой («Поделиться» + «Отменить») — чтобы
 *   кольца совпадали, а не спорили заливка-против-контура.
 *
 * `filled` у кита отсутствует для IconButton (только outline/bezeled/
 * plain/gray), поэтому «главного действия» здесь нет и маппить нечего:
 * главное действие — это ui/Button, а не иконка.
 */
export type IconButtonVariant = "secondary" | "ghost" | "gray" | "outline";
const MODES = {
  secondary: "bezeled",
  ghost: "plain",
  gray: "gray",
  outline: "outline",
} as const;

export interface IconButtonProps
  extends Omit<ComponentProps<typeof TguiIconButton>, "mode"> {
  /**
   * Обязателен: у кнопки-иконки нет текста, поэтому доступное имя задаётся
   * явно (WCAG 1.1.1 / 4.1.2). Забытый label не компилируется.
   */
  "aria-label": string;
  variant?: IconButtonVariant;
}

/**
 * Единая иконкная кнопка приложения.
 *
 * Решения по `mode` закреплены здесь, в одном месте. Пропсы кита
 * (size, disabled, type, title, ref, before/after) прокидываются
 * без изменений.
 */
export function IconButton({
  variant = "ghost",
  ...restProps
}: IconButtonProps) {
  return <TguiIconButton mode={MODES[variant]} {...restProps} />;
}
