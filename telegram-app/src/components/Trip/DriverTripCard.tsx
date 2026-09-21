import { Caption, Tappable, Text } from "@telegram-apps/telegram-ui";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { TripCard } from "@/components/Trip/TripCard";
import { haptic } from "@/utils/haptics";
import { dayLabel } from "@/utils/date";
import type { Trip } from "@edem/contracts";
import styles from "./TripCards.module.css";

function archivedStatusLabel(trip: Trip): { label: string; tone: StatusTone } {
  if (trip.status === "completed") return { label: "Завершена", tone: "info" };
  return { label: "Отменена", tone: "danger" };
}

/**
 * Легаси-обёртка для TripsPage: поездка водителя (активная — через
 * TripCard, архивная — компакт). Новый код использует TripCard напрямую.
 */
export function DriverTripCard({
  trip,
  archived,
  onManage,
  onShare,
  onComplete,
  onCancel,
  completePending,
  cancelPending,
}: {
  trip: Trip;
  archived: boolean;
  onRequests: (id: string) => void;
  onManage: (id: string) => void;
  onShare: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  completePending: boolean;
  cancelPending: boolean;
}) {
  if (archived) {
    const status = archivedStatusLabel(trip);
    return (
      <Tappable
        Component="button"
        type="button"
        onClick={() => {
          haptic.light();
          onManage(trip.id);
        }}
        className={styles.archived}
      >
        <div className={styles.archivedHead}>
          <Caption weight="2" caps className={styles.info}>
            Вы водитель
          </Caption>
          <StatusPill tone={status.tone} className={styles.shrink}>
            {status.label}
          </StatusPill>
        </div>
        <Text weight="2" Component="div">
          {trip.fromCity} → {trip.toCity}
        </Text>
        <Caption className={styles.archivedRow} Component="div">
          <span className={styles.truncate}>
            {dayLabel(trip.date)}, {trip.time}
          </span>
          <Text weight="2" Component="span" className={styles.shrink}>
            {trip.price} ₽ / место
          </Text>
        </Caption>
      </Tappable>
    );
  }

  return (
    <TripCard
      variant={{
        kind: "driving",
        trip,
        onShare,
        onCancel,
        cancelPending,
      }}
    />
  );
}
