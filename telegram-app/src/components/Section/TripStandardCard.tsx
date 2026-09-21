import type { ReactNode } from "react";
import {
  Avatar,
  Caption,
  Card,
  Cell,
  Headline,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { ArrowDown, Calendar, CarFront, MapPin } from "lucide-react";
import { formatRelativeDeparture } from "@/utils/bookingSplit";
import { RatingPill } from "@/components/RatingPill";
import styles from "./TripStandardCard.module.css";

export interface TripStandardPerson {
  name: string;
  avatar?: string | null;
  rating?: number | null;
  subtitle: string;
  showCarIcon?: boolean;
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
  return (
    <Card
      type="plain"
      className={styles.card}
      role="button"
      aria-label={`Открыть поездку ${fromCity} — ${toCity}`}
      onClick={() => onOpen(tripId)}
    >
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
      {personOverride ?? (
        <Cell
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
          after={<RatingPill size="s" value={person.rating ?? null} />}
        >
          <Subheadline level="2" Component="p" weight="1">
            {person.name}
          </Subheadline>
        </Cell>
      )}
      {footer && <div className={styles.footer}>{footer}</div>}
    </Card>
  );
}
