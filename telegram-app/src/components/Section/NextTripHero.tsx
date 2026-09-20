import {
  Avatar,
  AvatarStack,
  Badge,
  Caption,
  Card,
  Headline,
  Subheadline,
  Title,
} from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import { formatRelativeDeparture } from "@/utils/bookingSplit";
import { StatusPill } from "@/components/StatusPill";
import styles from "./NextTripHero.module.css";

export interface HeroPassenger {
  name: string;
  avatar?: string | null;
}

export interface HeroTrip {
  id: string;
  fromCity: string;
  toCity: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  departureAt?: string | null;
  seatsTotal?: number | null;
  seatsAvailable?: number | null;
  price?: number | null;
  /** Бронь пассажира: статус и номер места вместо счётчика мест. */
  bookingStatus?: "pending" | "confirmed" | null;
  bookingSeat?: number | null;
  /** Подтверждённые пассажиры (состав отдаст бэк; пока пусто). */
  passengers?: HeroPassenger[];
  /** Известный счётчик пассажиров без состава (своя поездка). */
  passengersCount?: number | null;
}

type BookingLike = {
  trip?: HeroTrip | null;
  seat?: number | null;
  status?: string;
};

type OwnTripLike = HeroTrip & { status?: string };

function tripTime(trip: HeroTrip | null | undefined): number {
  if (!trip?.departureAt) return Number.NaN;
  return Date.parse(trip.departureAt);
}

function isUpcomingTime(trip: HeroTrip | null | undefined, now: Date): boolean {
  const time = tripTime(trip);
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * Ближайшая upcoming-поездка: своя активная раньше брони пассажира.
 * Своя поездка обогащается счётчиком пассажиров из confirmedBookingsCount
 * либо занятых мест (состав API не отдаёт).
 */
export function pickNearestTrip(
  bookings: BookingLike[],
  ownTrips: OwnTripLike[],
  now: Date = new Date(),
): HeroTrip | null {
  const upcomingOwn = ownTrips
    .filter((trip) => isUpcomingTime(trip, now))
    .sort((a, b) => tripTime(a) - tripTime(b))[0];
  const upcomingBooking = bookings
    .filter((booking) => isUpcomingTime(booking.trip, now))
    .sort((a, b) => tripTime(a.trip) - tripTime(b.trip))[0];

  const withCount = (trip: OwnTripLike): HeroTrip => {
    const confirmed = (trip as { confirmedBookingsCount?: unknown })
      .confirmedBookingsCount;
    return {
      id: trip.id,
      fromCity: trip.fromCity,
      toCity: trip.toCity,
      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
      departureAt: trip.departureAt,
      seatsTotal: trip.seatsTotal,
      seatsAvailable: trip.seatsAvailable,
      price: trip.price,
      bookingStatus: null,
      bookingSeat: null,
      passengers: trip.passengers,
      // Только реальный счётчик бэка. Нет поля — неизвестно (null),
      // выдумывать пассажиров из занятых мест нельзя.
      passengersCount:
        trip.passengersCount ??
        (typeof confirmed === "number" ? confirmed : null),
    };
  };

  const withBooking = (booking: BookingLike): HeroTrip | null => {
    if (!booking.trip) return null;
    return {
      ...booking.trip,
      bookingStatus:
        booking.status === "pending" || booking.status === "confirmed"
          ? booking.status
          : null,
      bookingSeat:
        typeof booking.seat === "number"
          ? booking.seat
          : (booking.trip.bookingSeat ?? null),
    };
  };

  if (!upcomingOwn)
    return upcomingBooking ? withBooking(upcomingBooking) : null;
  if (!upcomingBooking?.trip) return withCount(upcomingOwn);
  return tripTime(upcomingOwn) <= tripTime(upcomingBooking.trip)
    ? withCount(upcomingOwn)
    : withBooking(upcomingBooking);
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function pluralize(
  count: number,
  forms: [string, string, string],
): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Hero ближайшей поездки на главной — по лекалам компактной карточки
 * (вкладка 4): шапка дата — места — цена, свой вертикальный маршрут
 * с номерными точками, стек пассажиров.
 */
export function NextTripHero() {
  const navigate = useNavigate();
  const { data: bookings = [] } = useMyBookingsQuery();
  const driverTrips = useInfiniteMyTripsQuery({ status: "active" });
  const ownTrips =
    driverTrips.data?.pages.flatMap((page) => page.items ?? []) ?? [];

  const trip = pickNearestTrip(
    bookings.filter((booking) => booking.trip != null),
    ownTrips,
  );
  if (!trip) return null;

  const freeSeats =
    typeof trip.seatsAvailable === "number" ? trip.seatsAvailable : null;
  const passengers = trip.passengers ?? [];
  const passengersCount =
    trip.passengersCount ?? (passengers.length > 0 ? passengers.length : 0);
  // Точно нет броней (счётчик 0) — свободны все места, а не «мест нет».
  const effectiveFreeSeats =
    passengersCount === 0 && typeof trip.seatsTotal === "number"
      ? trip.seatsTotal
      : freeSeats;

  return (
    <Card type="plain" className={styles.card}>
      <div
        className={styles.head}
        role="button"
        aria-label={`Ближайшая поездка ${trip.fromCity} — ${trip.toCity}`}
        onClick={() => navigate(`/trips/${trip.id}`)}
      >
        <Subheadline level="2" weight="2">
          {formatRelativeDeparture(trip.departureAt ?? undefined)}
        </Subheadline>
        <div className={styles.seats}>
          {trip.bookingStatus == null &&
            effectiveFreeSeats !== null &&
            (effectiveFreeSeats > 0 ? (
              <>
                мест:{" "}
                <Badge type="number" mode="white">
                  {effectiveFreeSeats}
                </Badge>
              </>
            ) : (
              <>мест нет</>
            ))}
          {trip.bookingStatus === "pending" && (
            <StatusPill tone="warning">Ожидает</StatusPill>
          )}
          {trip.bookingStatus === "confirmed" && (
            <StatusPill tone="success">
              Бронь №{trip.bookingSeat ?? "—"}
            </StatusPill>
          )}
        </div>
        {typeof trip.price === "number" && (
          <Headline weight="1" className={styles.price}>
            {trip.price} ₽
          </Headline>
        )}
      </div>
      <Title level="3" weight="2" className={styles.route}>
        {trip.fromCity} → {trip.toCity}
      </Title>
      <div className={styles.passengerStack}>
        {passengers.length > 0 && (
          <AvatarStack>
            {passengers.slice(0, 4).map((passenger) => (
              <Avatar
                key={passenger.name}
                size={28}
                src={passenger.avatar ?? undefined}
                acronym={initials(passenger.name)}
              />
            ))}
          </AvatarStack>
        )}
        <Caption className={styles.passengersLabel}>
          {passengersCount > 0
            ? `${pluralize(passengersCount, ["Пассажир", "Пассажира", "Пассажиров"])} (${passengersCount})`
            : "нет активных броней"}
        </Caption>
      </div>
    </Card>
  );
}
