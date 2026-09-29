import { Caption, Text, Textarea } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import {
  useCancelBookingMutation,
  useCreateBookingMutation,
} from "@/queries/useBookingsQuery";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import type { Trip } from "@edem/contracts";
import styles from "./TripDetailsPage.module.css";

interface BookingPanelProps {
  item: Trip;
  isDriver: boolean;
  isActive: boolean;
  departed: boolean;
  hasActiveBooking: boolean;
  canBook: boolean;
  effectiveSeat: number | null;
  takenSeats: number[];
  comment: string;
  createBooking: ReturnType<typeof useCreateBookingMutation>;
  onSelectSeat: (seat: number) => void;
  onCommentChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * Бронирование пассажира: баннер активной заявки, отмена, выбор места,
 * комментарий, цена, терминальные состояния (нет мест / уехала /
 * отменена / завершена). Мутация отмены — локально, создание — из
 * useTripActions (тот же инстанс, что и onSubmit).
 */
export function BookingPanel({
  item,
  isDriver,
  isActive,
  departed,
  hasActiveBooking,
  canBook,
  effectiveSeat,
  takenSeats,
  comment,
  createBooking,
  onSelectSeat,
  onCommentChange,
  onSubmit,
}: BookingPanelProps) {
  const cancelBooking = useCancelBookingMutation();

  return (
    <>
      {hasActiveBooking && item.myBooking && (
        <Notice tone="success" variant="banner">
          <div>
            <Text weight="2" Component="div" className={styles.success}>
              Вы записались попутчиком
            </Text>
            <Caption Component="div" className={styles.successMuted}>
              Место №{item.myBooking.seat} · {item.price} ₽
            </Caption>
          </div>
          <StatusPill
            tone={item.myBooking.status === "confirmed" ? "success" : "warning"}
          >
            {item.myBooking.status === "confirmed"
              ? "Подтверждено"
              : "На рассмотрении"}
          </StatusPill>
        </Notice>
      )}

      {item.myBooking && (
        <div className={styles.section}>
          {(item.myBooking.status === "pending" ||
            item.myBooking.status === "confirmed") && (
            <ConfirmPopup
              label="Отменить бронирование"
              confirmLabel="Отменить бронь"
              description="Заявка будет отменена, а место снова станет доступно."
              pending={cancelBooking.isPending}
              destructive
              onConfirm={() =>
                cancelBooking.mutate(item.myBooking!.id, {
                  onSuccess: () =>
                    hapticFeedback.notificationOccurred.ifAvailable("success"),
                })
              }
            />
          )}
          {cancelBooking.error && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(cancelBooking.error)}
            </Notice>
          )}
        </div>
      )}

      {canBook && (
        <div className={styles.sectionLoose}>
          <div role="group" aria-label="Выбор места">
            <Text weight="2" Component="p" className={styles.subtitle}>
              Место
            </Text>
            <div className={styles.seatGrid}>
              {Array.from(
                { length: item.seatsTotal },
                (_, index) => index + 1,
              ).map((seat) =>
                takenSeats.includes(seat) ? (
                  <Button
                    key={seat}
                    variant="outline"
                    disabled
                    aria-label={`Место ${seat} занято`}
                  >
                    {seat} (зан.)
                  </Button>
                ) : effectiveSeat === seat ? (
                  <Button
                    key={seat}
                    disabled={createBooking.isPending}
                    onClick={() => onSelectSeat(seat)}
                    aria-pressed
                    aria-label={`Место ${seat} выбрано`}
                  >
                    {seat}
                  </Button>
                ) : (
                  <Button
                    key={seat}
                    variant="outline"
                    disabled={createBooking.isPending}
                    onClick={() => onSelectSeat(seat)}
                    aria-pressed={false}
                    aria-label={`Выбрать место ${seat}`}
                  >
                    {seat}
                  </Button>
                ),
              )}
            </div>
          </div>
          <Field label="Комментарий водителю" id="booking-comment">
            {(field) => (
              <Textarea
                {...field}
                value={comment}
                maxLength={300}
                rows={3}
                placeholder="Например: буду с небольшим чемоданом, подойду к 9:25"
                onChange={(event) => onCommentChange(event.target.value)}
              />
            )}
          </Field>
          <div className={styles.priceRow}>
            <div>
              <Caption Component="div">Цена за место</Caption>
              <Text weight="2" Component="div">
                {item.price} ₽
              </Text>
            </div>
            <Caption Component="div" className={styles.payHint}>
              Оплата водителю
              <br />
              при посадке
            </Caption>
          </div>
          <Button
            size="l"
            stretched
            loading={createBooking.isPending}
            disabled={effectiveSeat === null || createBooking.isPending}
            onClick={onSubmit}
          >
            {effectiveSeat !== null
              ? `Забронировать место №${effectiveSeat} · ${item.price} ₽`
              : "Забронировать место"}
          </Button>
          {createBooking.error && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(createBooking.error)}
            </Notice>
          )}
        </div>
      )}

      {!isDriver &&
        isActive &&
        !departed &&
        item.seatsAvailable <= 0 &&
        !hasActiveBooking && (
          <EmptyState
            header={EMPTY_STATES.tripNoSeats.header}
            description={EMPTY_STATES.tripNoSeats.description}
          />
        )}
      {!isDriver && isActive && departed && (
        <EmptyState
          header={EMPTY_STATES.tripDeparted.header}
          description={EMPTY_STATES.tripDeparted.description}
        />
      )}
      {item.status === "cancelled" && (
        <EmptyState header={EMPTY_STATES.tripCancelled.header} />
      )}
      {item.status === "completed" && (
        <EmptyState header={EMPTY_STATES.tripCompleted.header} />
      )}
    </>
  );
}
