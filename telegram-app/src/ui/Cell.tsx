import type { ComponentProps } from "react";
import { Cell as TguiCell } from "@telegram-apps/telegram-ui";

import { AS_BUTTON } from "@/ui/classes";

/**
 * Единая строка-интерактив приложения.
 *
 * Обёртка над китовым `Cell`. Зачем она, если `Cell` можно импортировать
 * прямо (он не в списке запрещённых ESLint):
 *
 * 1. **Семантика.** Интерактивная строка обязана быть нативной кнопкой.
 *    `Component="button"` — документированный способ кита (Cell.d.ts:
 *    «Custom component or HTML tag to be used as the root element of the
 *    cell, div by default») и единственный способ получить фокус с
 *    клавиатуры, Enter/Space и роль кнопки у скринридера. Обходной путь
 *    `div` + `role="button"` без `tabIndex` (как было в NotificationsPage)
 *    недостижим для Tab — это WCAG 2.1.1, измеренный в браузере.
 *
 * 2. **Вид.** Кит UA-стили кнопки НЕ сбрасывает: `Cell` =
 *    `align-items:center;display:flex;gap:24px;padding:0 24px`, `Tappable` =
 *    `cursor:pointer;isolation:isolate;position:relative` — и всё. Замер A/B
 *    (кнопка против клона-`div` с теми же классами и содержимым) даёт
 *    Arial 13.33px, чёрный цвет, `appearance:auto`, `box-sizing:border-box`
 *    против `content-box` и ширину 356 против 404. Подробности —
 *    buttonReset.module.css.
 *
 *    Сброс применяется ко всем строкам (и к div, и к button): для div он
 *    no-op, кроме `box-sizing`, а тот уравнивает оба пути. Паддинг и
 *    раскладку не трогаем — они принадлежат киту, а наш модуль неслойный и
 *    бьёт `@layer tgui` при любой специфичности.
 *
 *    Компенсации вида (`text-align:left`, `background:transparent`,
 *    `border:0`) в модулях экранов после этого избыточны: `font/color/
 *    text-align` теперь `inherit`, фон и рамку снимает сброс.
 *
 * Остальные пропсы — контракт кита 1:1 (`Component`, `before`, `after`,
 * `subhead`, `subtitle`, `description`, `titleBadge`, `hint`, `multiline`,
 * `hovered`, `onClick`, `type`, `disabled`, `aria-*`, `ref`).
 */
export type CellProps = ComponentProps<typeof TguiCell>;

export function Cell({ className, ...restProps }: CellProps) {
  return (
    <TguiCell
      className={[AS_BUTTON, className].filter(Boolean).join(" ") || undefined}
      {...restProps}
    />
  );
}
