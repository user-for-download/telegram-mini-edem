import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { EditTripForm } from "@/components/Trip/EditTripForm";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { useTripBookingsQuery } from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
} from "@/queries/useTripsQuery";
import { useNavigate } from "react-router-dom";
import styles from "./TripDetailsPage.module.css";

interface DriverPanelProps {
  tripId: string;
  status: string | undefined;
  isActive: boolean;
  canCompleteTrip: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  trip: Parameters<typeof EditTripForm>[0]["trip"];
}

/**
 * Управление поездкой водителя: заявки, редактирование, завершение,
 * отмена. Заявки запрашиваются только здесь — остальным бэкенд вернёт 403.
 */
export function DriverPanel({
  tripId,
  status,
  isActive,
  canCompleteTrip,
  editing,
  onToggleEdit,
  trip,
}: DriverPanelProps) {
  const navigate = useNavigate();
  const cancelTrip = useCancelTripMutation();
  const completeTrip = useCompleteTripMutation();
  // Заявки видны только водителю: остальным бэкенд вернёт 403,
  // поэтому запрос делаем только здесь.
  const bookings = useTripBookingsQuery(tripId, { enabled: isActive });
  const pendingCount =
    bookings.data?.pages
      .flatMap((page) => page.items)
      .filter((booking) => booking.status === "pending").length ?? 0;

  return (
    <div className={styles.section}>
      <Text weight="2" Component="div">
        Управление поездкой
      </Text>
      {status === "completed" && (
        <Caption Component="p">
          Поездка завершена — пассажиры могут оставить отзыв.
        </Caption>
      )}
      {status === "cancelled" && (
        <Caption Component="p">
          Поездка отменена — недоступна для бронирования.
        </Caption>
      )}
      {isActive && (
        <>
          <Button
            stretched
            onClick={() => navigate(`/trips/my/${tripId}/requests`)}
          >
            Заявки пассажиров{bookings.data ? ` (${pendingCount})` : ""}
          </Button>
          {bookings.isError && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(bookings.error)}{" "}
              <Button
                variant="ghost"
                size="s"
                onClick={() => void bookings.refetch()}
              >
                Повторить
              </Button>
            </Notice>
          )}
          <Button stretched onClick={onToggleEdit}>
            {editing ? "Скрыть редактирование" : "Редактировать поездку"}
          </Button>
          {editing && <EditTripForm trip={trip} onDone={onToggleEdit} />}
          <ConfirmPopup
            label="Завершить поездку"
            confirmLabel="Завершить"
            description="Поездка будет перенесена в архив, а пассажиры смогут оставить отзывы."
            pending={completeTrip.isPending}
            disabled={
              !canCompleteTrip || completeTrip.isPending || cancelTrip.isPending
            }
            onConfirm={() => completeTrip.mutate(tripId)}
          />
          {!canCompleteTrip && (
            <p className={styles.hintXs}>
              Завершение станет доступно после времени отправления.
            </p>
          )}
          <ConfirmPopup
            label="Отменить поездку"
            confirmLabel="Отменить поездку"
            description="Поездка станет недоступна, а пассажиры получат уведомление об отмене."
            pending={cancelTrip.isPending}
            destructive
            onConfirm={() => cancelTrip.mutate(tripId)}
          />
          {(cancelTrip.error || completeTrip.error) && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(cancelTrip.error ?? completeTrip.error)}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
