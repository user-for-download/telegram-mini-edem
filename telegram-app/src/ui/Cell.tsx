import type { ComponentProps } from "react";
import { Cell as TguiCell } from "@telegram-apps/telegram-ui";

import { AS_BUTTON } from "@/ui/classes";

/**
 * Единая строка-интерактив приложения: обёртка над китовым `Cell`.
 *
 * Интерактивная строка обязана быть нативной кнопкой — `Component="button"`
 * документирован китом (Cell.d.ts) и даёт фокус, Enter/Space и роль кнопки.
 * Кит при этом не сбрасывает UA-стили кнопки, поэтому вид (шрифт, цвет,
 * `appearance`, `box-sizing`) держит сброс `AS_BUTTON`; замер расхождений и
 * rationale — в `buttonReset.module.css`.
 *
 * Сброс одинаков для обоих корней (button и div), иначе строки считались бы
 * по-разному. Паддинг и раскладку не трогаем — они принадлежат киту.
 *
 * Остальные пропсы — контракт кита 1:1.
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
