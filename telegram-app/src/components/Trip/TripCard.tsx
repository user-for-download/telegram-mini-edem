import { Button, IconButton } from "@telegram-apps/telegram-ui";
import { Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusPill, type StatusTone } from "@/components/StatusPill/StatusPill";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { ConfirmAction } from "@/components/ConfirmAction";
import { shareTrip } from "@/helpers/tripShare";
import { haptic } from "@/utils/haptics";
import type { PassengerBooking, Trip } from "@edem/contracts";
import styles from "./TripCards.module.css";

function bookingStatusLabel(status: string): {
  label: string;
  tone: StatusTone;
} {
  if (status === "confirmed") return { label: "Подтверждено", tone: "success" };
  if (status === "cancelled") return { label: "Отменено", tone: "danger" };
  if (status === "declined") return { label: "Отклонено", tone: "danger" };
  return { label: "На рассмотрении", tone: "warning" };
}

function tripStatusLabel(trip: Trip): { label: string; tone: StatusTone } {
  if (trip.status === "completed") return { label: "Завершена", tone: "info" };
  if (trip.status === "cancelled") return { label: "Отменена", tone: "danger" };
  const pending = trip.pendingRequestsCount ?? 0;
  if (pending > 0) return { label: `Заявки: ${pending}`, tone: "warning" };
  const confirmed = trip.confirmedBookingsCount ?? 0;
  if (confirmed > 0)
    return { label: `Забронировано: ${confirmed}`, tone: "success" };
  return { label: `Свободно: ${trip.seatsAvailable}`, tone: "info" };
}

export type TripCardVariant =
  | {
      kind: "booking";
      booking: PassengerBooking;
      onCancel: (id: string) => void;
      cancelPending: boolean;
    }
  | {
      kind: "driving";
      trip: Trip;
      driverRating?: number | null;
      onShare: (id: string) => void;
      onCancel: (id: string) => void;
      cancelPending: boolean;
    };

/**
 * Единая карточка поездки (стандарт вкладки): шапка дата — статус — цена,
 * маршрут, персона. Отличие одно:
 * - пассажир: Cell водителя;
 * - водитель без заявок: «Вы водитель»;
 * - водитель с заявками: строки заявок с −/+ вместо персоны.
 * Футеры: бронь — Детали/поделиться/Отмена; своя — Управление/поделиться/
 * Завершить/Отменить.
 */
export function TripCard({ variant }: { variant: TripCardVariant }) {
  const navigate = useNavigate();

  if (variant.kind === "booking") {
    const { booking, onCancel, cancelPending } = variant;
    const status = bookingStatusLabel(booking.status);
    const driver = booking.trip.driver;
    const car = driver.car
      ? `${driver.car.model} · ${driver.car.color}`
      : "Водитель";
    // Адреса — только подтверждённым (публичные ответы их маскируют).
    const confirmed = booking.status === "confirmed";
    return (
      <TripStandardCard
        tripId={booking.trip.id}
        fromCity={booking.trip.fromCity}
        toCity={booking.trip.toCity}
        fromAddress={confirmed ? booking.trip.fromAddress : null}
        toAddress={confirmed ? booking.trip.toAddress : null}
        departureAt={booking.trip.departureAt}
        price={booking.trip.price}
        headerStatus={
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        }
        person={{
          name: driver.name,
          avatar: driver.avatar,
          rating: driver.rating,
          subtitle: `${car} · место №${booking.seat}`,
          showCarIcon: Boolean(driver.car),
        }}
        onOpen={(id) => {
          haptic.light();
          navigate(`/trips/${id}`);
        }}
        footer={
          <>
            <Button
              size="s"
              mode="bezeled"
              className={styles.grow}
              onClick={(event) => {
                event.stopPropagation();
                haptic.light();
                navigate(`/trips/${booking.trip.id}`);
              }}
            >
              Детали поездки
            </Button>
            <IconButton
              size="s"
              mode="plain"
              aria-label="Поделиться поездкой"
              title="Поделиться поездкой"
              onClick={(event) => {
                event.stopPropagation();
                haptic.light();
                void shareTrip(booking.trip.id);
              }}
            >
              <Share2 size={15} />
            </IconButton>
            {(booking.status === "pending" ||
              booking.status === "confirmed") && (
              <ConfirmAction
                label="Отменить"
                confirmLabel="Отменить бронь"
                description="Заявка будет отменена, а место снова станет доступно."
                pending={cancelPending}
                mode="plain"
                destructive
                onConfirm={() => onCancel(booking.id)}
              />
            )}
          </>
        }
      />
    );
  }

  const { trip, driverRating, onCancel, cancelPending } = variant;
  const status = tripStatusLabel(trip);
  const pending = trip.pendingRequestsCount ?? 0;
  // Футер одинаковый для обеих ролей: Детали — поделиться — Отмена.
  // Завершить/управление живут в деталях поездки.
  return (
    <TripStandardCard
      tripId={trip.id}
      fromCity={trip.fromCity}
      toCity={trip.toCity}
      fromAddress={trip.fromAddress}
      toAddress={trip.toAddress}
      departureAt={trip.departureAt}
      price={trip.price}
      headerStatus={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      person={{
        name: "Вы водитель",
        subtitle: `Пассажиры: ${trip.confirmedBookingsCount ?? trip.seatsTotal - trip.seatsAvailable}`,
        rating: driverRating ?? null,
      }}
      // Есть активные заявки — вместо «Вы водитель» строки заявок с −/+.
      personOverride={
        pending > 0 ? <DriverTripRequests tripId={trip.id} /> : undefined
      }
      onOpen={(id) => {
        haptic.light();
        navigate(`/trips/${id}`);
      }}
      footer={
        // Всплытие гасят сами кнопки (Button/IconButton/ConfirmAction) —
        // обёртка с onClick запрещена jsx-a11y (см. ConfirmAction.stop).
        <div className={styles.actions}>
          <div className={styles.btnRow}>
            <Button
              size="s"
              mode="bezeled"
              className={styles.grow}
              onClick={(event) => {
                event.stopPropagation();
                haptic.light();
                navigate(`/trips/${trip.id}`);
              }}
            >
              Детали поездки
            </Button>
            <IconButton
              size="s"
              mode="plain"
              aria-label="Поделиться поездкой"
              title="Поделиться поездкой"
              onClick={(event) => {
                event.stopPropagation();
                haptic.light();
                void shareTrip(trip.id);
              }}
            >
              <Share2 size={15} />
            </IconButton>
            <ConfirmAction
              label="Отменить"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна, а пассажиры получат уведомление."
              pending={cancelPending}
              mode="plain"
              destructive
              onConfirm={() => onCancel(trip.id)}
            />
          </div>
        </div>
      }
    />
  );
}
