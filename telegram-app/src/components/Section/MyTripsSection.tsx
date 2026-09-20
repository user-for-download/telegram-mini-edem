import { useMemo, useState } from "react";
import {
  ButtonCell,
  IconButton,
  Section,
  Skeleton,
} from "@telegram-apps/telegram-ui";
import { ChevronRight, List as ListIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TripCell } from "@/components/TripCell";
import { haptic } from "@/utils/haptics";
import {
  confirmedSectionHeader,
  formatSeatNumber,
  splitBookingsByStatus,
} from "@/utils/bookingSplit";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";

/** Превью списков «Ваши поездки»: первые N, остальные — за кнопкой. */
const PREVIEW_LIMIT = 3;

/**
 * «Ваши поездки» с главной: подтверждённые и ожидающие брони пассажира
 * на шаблоне TripCell (title — маршрут, subtitle — водитель,
 * description — `цена₽ · место · дата · время`). Списки длиннее превью
 * раскрываются кнопкой «Показать все». Скрыта, если бронирований нет.
 */
export function MyTripsSection() {
  const navigate = useNavigate();
  const bookings = useMyBookingsQuery();
  const [expandedConfirmed, setExpandedConfirmed] = useState(false);
  const [expandedPending, setExpandedPending] = useState(false);

  // Брони двумя группами по статусу (будущие confirmed и pending).
  const { confirmed, pending } = useMemo(
    () => splitBookingsByStatus(bookings.data ?? []),
    [bookings.data],
  );

  const openTrip = (tripId: string) => {
    haptic.light();
    navigate(`/trips/${tripId}`);
  };

  return (
    <Skeleton visible={bookings.isLoading} withoutAnimation>
      {confirmed.length > 0 && (
        <Section header={confirmedSectionHeader(confirmed.length)}>
          {(expandedConfirmed
            ? confirmed
            : confirmed.slice(0, PREVIEW_LIMIT)
          ).map((booking) => (
            <TripCell
              key={booking.id}
              avatar={{
                src: booking.trip.driver.avatar,
                name: booking.trip.driver.name ?? "?",
                rating: booking.trip.driver.rating,
              }}
              title={`${booking.trip.fromCity} → ${booking.trip.toCity}`}
              subtitle={booking.trip.driver.name ?? "Водитель"}
              description={`${booking.trip.price}₽ · ${formatSeatNumber(booking.seat)} · ${booking.trip.date} · ${booking.trip.time}`}
              after={
                <IconButton
                  mode="bezeled"
                  size="s"
                  aria-label="Открыть поездку"
                  onClick={() => openTrip(booking.trip.id)}
                >
                  <ChevronRight size={20} />
                </IconButton>
              }
              onOpen={() => openTrip(booking.trip.id)}
            />
          ))}
          {confirmed.length > PREVIEW_LIMIT && (
            <ButtonCell
              mode="default"
              before={<ListIcon size={20} />}
              onClick={() => setExpandedConfirmed((value) => !value)}
            >
              {expandedConfirmed
                ? "Свернуть"
                : `Показать все (${confirmed.length})`}
            </ButtonCell>
          )}
        </Section>
      )}
      {pending.length > 0 && (
        <Section header="Ожидают подтверждения">
          {(expandedPending ? pending : pending.slice(0, PREVIEW_LIMIT)).map(
            (booking) => (
              <TripCell
                key={booking.id}
                avatar={{
                  src: booking.trip.driver.avatar,
                  name: booking.trip.driver.name ?? "?",
                  rating: booking.trip.driver.rating,
                }}
                title={`${booking.trip.fromCity} → ${booking.trip.toCity}`}
                subtitle={booking.trip.driver.name ?? "Водитель"}
                description={`${booking.trip.price}₽ · ${formatSeatNumber(booking.seat)} · ${booking.trip.date} · ${booking.trip.time}`}
                after={
                  <IconButton
                    mode="bezeled"
                    size="s"
                    aria-label="Открыть поездку"
                    onClick={() => openTrip(booking.trip.id)}
                  >
                    <ChevronRight size={20} />
                  </IconButton>
                }
                onOpen={() => openTrip(booking.trip.id)}
              />
            ),
          )}
          {pending.length > PREVIEW_LIMIT && (
            <ButtonCell
              mode="default"
              before={<ListIcon size={20} />}
              onClick={() => setExpandedPending((value) => !value)}
            >
              {expandedPending
                ? "Свернуть"
                : `Показать все (${pending.length})`}
            </ButtonCell>
          )}
        </Section>
      )}
    </Skeleton>
  );
}
