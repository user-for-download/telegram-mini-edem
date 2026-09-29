import { Banner, IconContainer } from "@telegram-apps/telegram-ui";
import { Armchair, Car } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import { dayLabel } from "@/utils/date";
import { haptic } from "@/utils/haptics";
import styles from "./NextTripBanner.module.css";

interface NextTripSource {
  id: string;
  fromCity: string;
  toCity: string;
  departureAt?: string;
  price: number;
  seatsAvailable: number;
}

export interface NextTrip extends NextTripSource {
  tripId: string;
  role: "driver" | "passenger";
  /** Номер места — только у брони пассажира. */
  seat?: number;
}

/**
 * Ближайшая предстоящая поездка среди активных броней пассажира
 * и активных поездок водителя. null — баннер прячем.
 * Чистая: покрыта юнитом без моков запросов.
 */
export function pickNextTrip(
  bookings: Array<{ status: string; scope?: string; seat: number; trip: NextTripSource }>,
  driverTrips: NextTripSource[],
  now: number = Date.now(),
): NextTrip | null {
  const candidates: NextTrip[] = [];
  for (const booking of bookings) {
    if (
      (booking.status === "pending" || booking.status === "confirmed") &&
      booking.scope !== "history" &&
      booking.trip.departureAt &&
      Date.parse(booking.trip.departureAt) > now
    ) {
      candidates.push({
        ...booking.trip,
        tripId: booking.trip.id,
        role: "passenger",
        seat: booking.seat,
      });
    }
  }
  for (const trip of driverTrips) {
    if (trip.departureAt && Date.parse(trip.departureAt) > now) {
      candidates.push({ ...trip, tripId: trip.id, role: "driver" });
    }
  }
  candidates.sort(
    (a, b) => Date.parse(a.departureAt ?? "") - Date.parse(b.departureAt ?? ""),
  );
  return candidates[0] ?? null;
}

/**
 * Баннер главной с ближайшей поездкой/бронью. Своих отступов нет —
 * ритм даёт Page/List. Пока идёт загрузка или предстоящего нет —
 * null (прогрессивное улучшение, не скелетон).
 */
export function NextTripBanner() {
  const navigate = useNavigate();
  const bookings = useMyBookingsQuery();
  const driverTrips = useInfiniteMyTripsQuery({ status: "active" });

  if (bookings.isLoading || driverTrips.isLoading) return null;
  const next = pickNextTrip(
    (bookings.data ?? []) as Parameters<typeof pickNextTrip>[0],
    (driverTrips.data?.pages.flatMap((page) => page.items) ?? []) as NextTripSource[],
  );
  if (!next) return null;

  const [dateIso = "", timeRaw = ""] = next.departureAt?.split("T") ?? [];
  const when = `${dayLabel(dateIso)}, ${timeRaw.slice(0, 5)}`;
  const seatInfo =
    next.role === "passenger" && next.seat !== undefined
      ? `место ${next.seat}`
      : `свободно ${next.seatsAvailable}`;
  const label = `${next.fromCity} — ${next.toCity}, ${when}`;

  const go = () => {
    haptic.light();
    navigate(`/trips/${next.tripId}`);
  };

  return (
    <Banner
      type="inline"
      className={styles.banner}
      before={
        <IconContainer>
          {next.role === "driver" ? (
            <Car size={44} aria-hidden />
          ) : (
            <Armchair size={44} aria-hidden />
          )}
        </IconContainer>
      }
      callout={next.role === "driver" ? "Едете как водитель" : "Едете как пассажир"}
      header={`${next.fromCity} → ${next.toCity}`}
      description={`${when} · ${next.price} ₽ · ${seatInfo}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go();
        }
      }}
      data-testid="next-trip-banner"
    />
  );
}
