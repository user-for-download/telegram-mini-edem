import type { ReactNode } from "react";
import {
  Avatar,
  Caption,
  Headline,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import type { TripPassenger } from "@edem/contracts";
import { ArrowDown, Calendar, CarFront, MapPin } from "lucide-react";
import { formatRelativeDeparture } from "@/utils/bookingSplit";
import { RatingPill } from "@/components/RatingPill";
import { AvatarStack } from "@/components/Trip/AvatarStack";
import { Card } from "@/ui/Card";
import { Cell } from "@/ui/Cell";
import { VISUALLY_HIDDEN } from "@/ui/classes";
import styles from "./TripStandardCard.module.css";

export interface TripStandardPerson {
  name: string;
  avatar?: string | null;
  rating?: number | null;
  subtitle: string;
  showCarIcon?: boolean;
  /**
   * Подтверждённые пассажиры. Если поле задано (даже пустое) — вместо
   * рейтинга справа рисуется аватарстак. Нужно карточке водителя: свой
   * рейтинг ему не интересен, а пассажиры — да.
   */
  passengers?: TripPassenger[];
}

export interface TripStandardCardProps {
  tripId: string;
  fromCity: string;
  toCity: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  departureAt?: string | null;
  price?: number | null;
  /** Пилюля статуса в шапке (StatusPill): бронь/поездка — снаружи. */
  headerStatus: ReactNode;
  /** Строка персоны: водитель у брони, «Вы водитель» у своей. */
  person: TripStandardPerson;
  /** Замена персоны целиком (активные заявки водителя). */
  personOverride?: ReactNode;
  /** Кнопки действий под карточкой (детали/поделиться/отмена...). */
  footer?: ReactNode;
  onOpen: (tripId: string) => void;
}

/**
 * Стандарт карточки поездки (вкладка «Поездки», активные):
 * шапка дата — статус — цена, свой вертикальный маршрут
 * (синие точки + стрелка, города и адреса), Cell персоны с иконками.
 * Тап по карточке — детали поездки.
 */
export function TripStandardCard({
  tripId,
  fromCity,
  toCity,
  fromAddress,
  toAddress,
  departureAt,
  price,
  headerStatus,
  person,
  personOverride,
  footer,
  onOpen,
}: TripStandardCardProps) {
  const open = () => onOpen(tripId);

  // Открытие поездки — НАСТОЯЩАЯ кнопка, а не div с role/tabIndex.
  //
  // Кнопкой обёрнуто только гарантированно неинтерактивное содержимое
  // (шапка, маршрут и — когда personOverride не переопределён — строка
  // персоны). Слоты с действиями (футер и personOverride со строками
  // заявок −/+) остаются СОСЕДЯМИ кнопки, а не её потомками: запрет
  // касается кнопок ВНУТРИ кнопки, а не соседних областей карточки.
  //
  // Тап мышью по любой части карточки по-прежнему открывает детали: на корне
  // остаётся onClick, а кнопка гасит всплытие, чтобы не открыть дважды.
  // Клавиатура получила нативную кнопку: фокус, Enter/Space, роль — из коробки.
  const hasInteractiveOverride = personOverride !== undefined;

  const content = (
    <>
      <div className={styles.head}>
        <span className={styles.when}>
          <Calendar size={14} aria-hidden />
          <Subheadline level="2" weight="2">
            {formatRelativeDeparture(departureAt ?? undefined)}
          </Subheadline>
        </span>
        <div className={styles.seats}>{headerStatus}</div>
        {typeof price === "number" && (
          <Headline weight="1" className={styles.price}>
            {price} ₽
          </Headline>
        )}
      </div>
      <div className={styles.route}>
        {(
          [
            { city: fromCity, place: fromAddress },
            { city: toCity, place: toAddress },
          ] as const
        ).map((stop, index) => (
          <div className={styles.stop} key={`${stop.city}-${index}`}>
            <div className={styles.rail}>
              <MapPin size={16} className={styles.pin} aria-hidden />
              {index === 0 && (
                <>
                  <span className={styles.vbar} />
                  <ArrowDown size={14} className={styles.arrow} aria-hidden />
                  <span className={styles.vbar} />
                </>
              )}
            </div>
            <div className={styles.stopBody}>
              <span className={styles.city}>{stop.city}</span>
              {stop.place && <span className={styles.place}>{stop.place}</span>}
            </div>
          </div>
        ))}
      </div>
      {!hasInteractiveOverride && (
        <Cell
          className={styles.person}
          before={
            <Avatar
              size={40}
              src={person.avatar ?? undefined}
              acronym={person.name.slice(0, 2).toUpperCase()}
            />
          }
          subtitle={
            <Caption level="1" Component="p" weight="2">
              <span className={styles.car}>
                {person.showCarIcon && <CarFront size={14} aria-hidden />}
                {person.subtitle}
              </span>
            </Caption>
          }
          after={
            person.passengers !== undefined ? (
              <AvatarStack users={person.passengers} />
            ) : (
              <RatingPill size="s" value={person.rating ?? null} />
            )
          }
        >
          <Subheadline level="2" Component="p" weight="1">
            {person.name}
          </Subheadline>
        </Cell>
      )}
    </>
  );

  return (
    <Card variant="flush" className={styles.card} onClick={open}>
      <button
        type="button"
        className={styles.open}
        onClick={(event) => {
          // Корневому onClick это не нужно — но без гашения тап по кнопке
          // всплыл бы и открыл детали дважды.
          event.stopPropagation();
          open();
        }}
      >
        {/* Видимое содержимое кнопки — и есть её имя; глагол добавляем
            скрыто, чтобы скринридеру было ясно, что это переход. */}
        <span className={VISUALLY_HIDDEN}>Открыть поездку</span>
        {content}
      </button>
      {hasInteractiveOverride && personOverride}
      {footer && <div className={styles.footer}>{footer}</div>}
    </Card>
  );
}
