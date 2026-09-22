import type { ReactNode } from "react";
import { Avatar, Caption, Cell, Subheadline } from "@telegram-apps/telegram-ui";

export interface TripCellAvatar {
  src?: string | null;
  name: string;
  /** Рейтинг бейджем на аватаре; null/undefined — без бейджа. */
  rating?: number | null;
}

export interface TripCellProps {
  /** Аватар слева; без него — обычная ячейка без before. */
  avatar?: TripCellAvatar;
  /** Заголовок — обычно маршрут «откуда → куда». */
  title: ReactNode;
  /** Подзаголовок — обычно имя участника. */
  subtitle?: ReactNode;
  /** Мета-строка — цена · место · дата · время и т.п. */
  description?: ReactNode;
  /** Слот действий справа. */
  after?: ReactNode;
  /** Тап по ячейке; без него ячейка статичная. */
  onOpen?: () => void;
  ariaLabel?: string;
}

/**
 * Универсальный шаблон ячейки поездки: единый Avatar 48 с бейджем
 * рейтинга, типографика Subheadline/Caption, опциональные слоты after
 * и onOpen. Весь контент — через пропсы, макет один на всех.
 *
 * Эталон заполнения:
 * - title (шапка) — маршрут «ОТКУДА → КУДА», например
 *   `${trip.fromCity} → ${trip.toCity}`;
 * - subtitle (кто) — имя участника: водитель в «Ваших поездках»,
 *   пассажир в заявках;
 * - description (остальное) — одна строка мета, шаблон
 *   `{price}₽ · {formatSeatNumber(seat)} · {date} · {time}`;
 * - avatar — участник из subtitle (его фото, имя, рейтинг);
 * - after — действие справа (шеврон, кнопка досье, статус);
 * - onOpen — тап по ячейке; без него ячейка статичная.
 */
export function TripCell({
  avatar,
  title,
  subtitle,
  description,
  after,
  onOpen,
  ariaLabel,
}: TripCellProps) {
  const ratingLabel = avatar?.rating != null ? avatar.rating.toFixed(1) : null;

  return (
    <Cell
      // Кликабельная ячейка обязана быть настоящей кнопкой: tgui Cell
      // по умолчанию рендерит div, type="button" на div не даёт
      // клавиатурной доступности (a11y: кликабельный div без роли).
      Component={onOpen ? "button" : undefined}
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      aria-label={ariaLabel}
      before={
        avatar ? (
          <Avatar
            size={48}
            src={avatar.src ?? undefined}
            acronym={avatar.name.slice(0, 2).toUpperCase()}
          >
            {ratingLabel !== null && (
              <Avatar.Badge mode="white" type="number">
                {ratingLabel}
              </Avatar.Badge>
            )}
          </Avatar>
        ) : undefined
      }
      subtitle={
        subtitle ? (
          <Caption level="1" Component="p" weight="2">
            {subtitle}
          </Caption>
        ) : undefined
      }
      description={
        description ? (
          <Caption level="1" Component="p" weight="3">
            {description}
          </Caption>
        ) : undefined
      }
      after={after}
    >
      <Subheadline level="2" Component="p" weight="1">
        {title}
      </Subheadline>
    </Cell>
  );
}
