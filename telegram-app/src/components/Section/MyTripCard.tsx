import {
  Avatar,
  Caption,
  Card,
  Cell,
  Headline,
  IconButton,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import {
  ArrowDown,
  Calendar,
  CarFront,
  ChevronRight,
  MapPin,
} from "lucide-react";
import { formatRelativeDeparture } from "@/utils/bookingSplit";
import { StatusPill } from "@/components/StatusPill";
import styles from "./MyTripCard.module.css";

export interface MyTripCardDriver {
  name?: string | null;
  avatar?: string | null;
  rating?: number | null;
  car?: { model: string; color: string } | null;
}

export interface MyTripCardTrip {
  id: string;
  fromCity: string;
  toCity: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  departureAt?: string | null;
  time?: string | null;
  price?: number | null;
  driver: MyTripCardDriver;
}

export interface MyTripCardProps {
  seat?: number | null;
  status: "pending" | "confirmed";
  trip: MyTripCardTrip;
  onOpen: (tripId: string) => void;
}

/**
 * Карточка «Ваши поездки»: шапка как в баннере (дата — статус — цена),
 * свой вертикальный маршрут (номерные точки, обе синие), Cell водителя.
 */
export function MyTripCard({ seat, status, trip, onOpen }: MyTripCardProps) {
  const driverName = trip.driver.name ?? "Водитель";
  const driverCar = trip.driver.car;
  const ratingLabel =
    trip.driver.rating != null ? trip.driver.rating.toFixed(1) : null;

  return (
    <Card
      type="plain"
      className={styles.card}
      role="button"
      aria-label={`Открыть поездку ${trip.fromCity} — ${trip.toCity}`}
      onClick={() => onOpen(trip.id)}
    >
      <div className={styles.head}>
        <span className={styles.when}>
          <Calendar size={14} aria-hidden />
          <Subheadline level="2" weight="2">
            {formatRelativeDeparture(trip.departureAt ?? undefined)}
          </Subheadline>
        </span>
        <div className={styles.seats}>
          {status === "pending" && (
            <StatusPill tone="warning">Ожидает</StatusPill>
          )}
          {status === "confirmed" && (
            <StatusPill tone="success">Бронь №{seat ?? "—"}</StatusPill>
          )}
        </div>
        {typeof trip.price === "number" && (
          <Headline weight="1" className={styles.price}>
            {trip.price} ₽
          </Headline>
        )}
      </div>
      <div className={styles.route}>
        {(
          [
            {
              city: trip.fromCity,
              place: status === "confirmed" ? trip.fromAddress : null,
            },
            {
              city: trip.toCity,
              place: status === "confirmed" ? trip.toAddress : null,
            },
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
      <Cell
        before={
          <Avatar
            size={48}
            src={trip.driver.avatar ?? undefined}
            acronym={driverName.slice(0, 2).toUpperCase()}
          >
            {ratingLabel !== null && (
              <Avatar.Badge mode="white" type="number">
                {ratingLabel}
              </Avatar.Badge>
            )}
          </Avatar>
        }
        subtitle={
          <Caption level="1" Component="p" weight="2">
            <span className={styles.car}>
              {driverCar && <CarFront size={14} aria-hidden />}
              {driverCar
                ? `${driverCar.model} · ${driverCar.color}`
                : "Водитель"}
            </span>
          </Caption>
        }
        after={
          <IconButton mode="bezeled" size="s" aria-label="Открыть поездку">
            <ChevronRight size={20} />
          </IconButton>
        }
      >
        <Subheadline level="2" Component="p" weight="1">
          {driverName}
        </Subheadline>
      </Cell>
    </Card>
  );
}
