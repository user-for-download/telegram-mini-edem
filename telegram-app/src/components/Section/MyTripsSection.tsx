import { useMemo, useState } from "react";
import { ButtonCell, Section, Skeleton } from "@telegram-apps/telegram-ui";
import { List as ListIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MyTripCard } from "@/components/Section/MyTripCard";
import { haptic } from "@/utils/haptics";
import {
  confirmedSectionHeader,
  splitBookingsByStatus,
} from "@/utils/bookingSplit";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";

/** Превью списков «Ваши поездки»: первые N, остальные — за кнопкой. */
const PREVIEW_LIMIT = 3;

/**
 * «Ваши поездки» с главной: подтверждённые и ожидающие брони пассажира
 * карточками MyTripCard (шапка как в баннере, Timeline маршрута,
 * Cell водителя). Списки длиннее превью раскрываются кнопкой
 * «Показать все». Скрыта, если бронирований нет.
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
            <MyTripCard
              key={booking.id}
              seat={booking.seat}
              status="confirmed"
              trip={booking.trip}
              onOpen={openTrip}
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
              <MyTripCard
                key={booking.id}
                seat={booking.seat}
                status="pending"
                trip={booking.trip}
                onOpen={openTrip}
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
