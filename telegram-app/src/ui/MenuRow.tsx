import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Cell } from "@/ui/Cell";
import styles from "./MenuRow.module.css";

export interface MenuRowProps {
  /** Иконка строки — обёртывается в `<IconContainer>` вызывающим. */
  icon: ReactNode;
  /** Заголовок: имя строки для глаза. */
  title: string;
  /** Подпись: одна строка, усекается. */
  subtitle: string;
  onClick: () => void;
  /**
   * Имя строки для скринридера. Обычно равно `title`; отдельное поле нужно,
   * когда на глаз строка называется иначе (например, «История запросов» —
   * это то, как пункт называется в меню).
   */
  label?: string;
}

/**
 * Строка меню: иконка, заголовок, подпись, шеврон (учебниковый паттерн
 * стори Playground на китовом `Cell`).
 *
 * Живёт в `ui/`, потому что строки такого вида нужны минимум на двух экранах:
 * меню профиля (`pages/Profile`) и лента спроса на главной
 * (`RideRequestFeedSection`). Второе место — ровно то, где пришлось ловить
 * дефект: без `width: 100%` кнопка `Cell` по размеру контента (min-content) и
 * длинная подпись растягивала строку за карточку секции (553px при секции
 * 356px на 390-экране).
 *
 * `Cell` идёт через `Component="button"` (реестр #12: интерактивная строка
 * обязана быть нативной кнопкой — иначе не фокусируется Tab'ом и не
 * опознаётся скринридером).
 */
export function MenuRow({ icon, title, subtitle, onClick, label }: MenuRowProps) {
  return (
    <Cell
      Component="button"
      type="button"
      // Имя = заголовок + подпись: видимая подпись входит в имя.
      aria-label={`${label ?? title}. ${subtitle}`}
      onClick={onClick}
      before={<span className={styles.icon}>{icon}</span>}
      after={<ChevronRight size={16} className={styles.chevron} />}
      subtitle={subtitle}
      className={styles.row}
    >
      {title}
    </Cell>
  );
}
