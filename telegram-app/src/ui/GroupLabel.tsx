import type { ReactNode } from "react";
import { Caption } from "@telegram-apps/telegram-ui";
import styles from "./GroupLabel.module.css";

/**
 * Заголовок группы внутри шторки/карточки: «Ожидают решения (3)»,
 * «В поездке (1)», «Управление поездкой», «Выберите место».
 *
 * Это НАДпись над группой, а не заголовок экрана: `ui/Section` отвечает за
 * секции страницы (15/600, тон `--app-info`), а здесь роль другая — мета
 * (13/600, `--app-muted`). До компонента роль была скопирована в четырёх
 * модулях, причём в двух из них — с разным тоном (один primary, другой
 * muted), поэтому одинаковые по смыслу подписи выглядели по-разному.
 *
 * Живёт в `ui/`, потому что нужен минимум трём местам (детали поездки,
 * пассажиры, шторка заявок) — правило 5 в ui/README.
 *
 * Своего паддинга у подписи нет: отступы принадлежат раскладке родителя
 * (SheetBody/Stack), иначе метка переставала бы выравниваться с карточками.
 */
export function GroupLabel({
  children,
  className,
  Component = "p",
}: {
  children: ReactNode;
  className?: string;
  Component?: "p" | "div" | "span";
}) {
  return (
    <Caption
      weight="2"
      Component={Component}
      className={[styles.label, className].filter(Boolean).join(" ")}
    >
      {children}
    </Caption>
  );
}
