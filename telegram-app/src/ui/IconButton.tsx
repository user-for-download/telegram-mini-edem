import type { ComponentProps } from "react";
import { IconButton as TguiIconButton } from "@telegram-apps/telegram-ui";

/**
 * Смысловые варианты иконкной кнопки → режимы кита (маппинг 1:1, как у
 * `ui/Button`): выбор «какая это кнопка» перестаёт быть выбором `mode`.
 *
 * - `secondary` (bezeled) — обычная кнопка-действие;
 * - `ghost` (plain, по умолчанию) — «тихая» иконка в строке;
 * - `muted` (gray) — нейтральная иконка-действие на поверхности карточки.
 *
 * `filled` у кита отсутствует для IconButton (только outline/bezeled/
 * plain/gray), поэтому «главного действия» здесь нет и маппить нечего:
 * главное действие — это ui/Button, а не иконка.
 */
export type IconButtonVariant = "secondary" | "ghost" | "muted";

const MODES = {
  secondary: "bezeled",
  ghost: "plain",
  muted: "gray",
} as const;

export interface IconButtonProps
  extends Omit<ComponentProps<typeof TguiIconButton>, "mode"> {
  /**
   * Обязателен: у кнопки-иконки нет текста, поэтому доступное имя задаётся
   * явно (WCAG 1.1.1 / 4.1.2). Раньше об этом думало каждое из 13 мест
   * само — теперь забытый label не компилируется.
   */
  "aria-label": string;
  variant?: IconButtonVariant;
}

/**
 * Единая иконкная кнопка приложения (сессия
 * .tmp/sessions/2026-09-25-ui-canon-parity, K1).
 *
 * Прямой китовый `IconButton` использовался в 5 файлах (13 мест) с руками
 * подобранными `mode`/`size`/`aria-label` — здесь эти решения закреплены в
 * одном месте. Пропсы кита (size, disabled, type, title, ref, before/after)
 * прокидываются без изменений.
 */
export function IconButton({
  variant = "ghost",
  ...restProps
}: IconButtonProps) {
  return <TguiIconButton mode={MODES[variant]} {...restProps} />;
}
