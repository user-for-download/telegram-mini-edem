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
  /**
   * Подпись переносится, а не усекается (штатный проп кита `multiline`,
   * «Allows for multiline content without truncation»).
   *
   * По умолчанию кит рисует подпись с `white-space: nowrap` +
   * `text-overflow: ellipsis`: длинный текст не переносится, а ОБРЕЗАЕТСЯ
   * многоточием. Для коротких подписей меню это верно, но для подписи с
   * данными в хвосте (ленты спроса: «2 человека · 7 мест · Завтра, 08:00»)
   * обрезается ровно то, ради чего строка и нужна. Проп нужен ровно там, где
   * подпись несёт значения, которые нельзя потерять.
   */
  multiline?: boolean;
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
 *
 * `multiline` прокидывается в кит 1:1: обрезать подпись с данными нельзя,
 * а своих правил на внутренние классы кита мы не пишем (хеш класса меняется
 * при bump версии, проп — публичный контракт).
 */
export function MenuRow({
  icon,
  title,
  subtitle,
  onClick,
  label,
  multiline,
}: MenuRowProps) {
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
      multiline={multiline}
      className={styles.row}
    >
      {title}
    </Cell>
  );
}
