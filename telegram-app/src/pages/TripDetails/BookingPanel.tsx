import { Caption, Headline, Text, Textarea } from "@telegram-apps/telegram-ui";
import { useId, useState } from "react";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { GroupLabel } from "@/ui/GroupLabel";
import { GROW, MIN_TARGET, SHRINK } from "@/ui/classes";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import {
  useCancelBookingMutation,
  useCreateBookingMutation,
} from "@/queries/useBookingsQuery";
import { haptic } from "@/utils/haptics";
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
}

/**
 * Статус собственной брони — отдельным блоком вверху шторки.
 *
 * Раньше он стоял после водителя и комментария, то есть ниже всей
 * описательной части. Для пассажира с заявкой это главный ответ на вопрос
 * «что с моей бронью», поэтому блок идёт первым. Pending — нейтральный
 * info, confirmed — зелёный success: ожидание не должно выглядеть как
 * состоявшееся подтверждение.
 */
export function BookingStatus({ item }: { item: Trip }) {
  const booking = item.myBooking;
  if (!booking) return null;
  const confirmed = booking.status === "confirmed";

  return (
    <Notice tone={confirmed ? "success" : "info"} variant="banner">
      <div className={GROW}>
        <Text
          weight="2"
          Component="div"
          className={confirmed ? styles.success : undefined}
        >
          {confirmed ? "Бронь подтверждена" : "Заявка отправлена"}
        </Text>
        <Caption
          Component="div"
          className={confirmed ? styles.successMuted : undefined}
        >
          Место №{booking.seat} · {item.price} ₽
          {confirmed ? " · Оплата при посадке" : " · Ждём решения водителя"}
        </Caption>
      </div>
      <StatusPill tone={confirmed ? "success" : "info"} className={SHRINK}>
        {confirmed ? "Подтверждено" : "На рассмотрении"}
      </StatusPill>
    </Notice>
  );
}

/**
 * Бронирование пассажира: выбор места, раскрываемый комментарий,
 * терминальные состояния (нет мест / уехала).
 * Цена и основное действие — последним блоком формы.
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
}: BookingPanelProps) {
  // Комментарий нужен редко: постоянная textarea съедала треть высоты до
  // цены. Уже введённый текст (или возврат на экран) оставляет поле
  // открытым.
  const [commentOpen, setCommentOpen] = useState(comment.length > 0);
  const commentPanelId = useId();

  return (
    <>
      {canBook && (
        <div className={styles.sectionLoose}>
          <div role="group" aria-label="Выбор места">
            <GroupLabel>Выберите место</GroupLabel>
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
                    variant="primary"
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

          <Button
            variant="ghost"
            stretched
            className={styles.addComment}
            aria-expanded={commentOpen}
            aria-controls={commentPanelId}
            onClick={() => setCommentOpen((value) => !value)}
          >
            {commentOpen ? "Скрыть комментарий" : "Добавить комментарий водителю"}
          </Button>
          <div id={commentPanelId} hidden={!commentOpen}>
            {commentOpen && (
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
            )}
          </div>
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
    </>
  );
}

/** Вторичная отмена своей брони — после всех сведений о поездке. */
export function BookingCancellation({
  item,
  isActive,
}: {
  item: Trip;
  isActive: boolean;
}) {
  const cancelBooking = useCancelBookingMutation();
  const booking = item.myBooking;
  if (
    !isActive ||
    !booking ||
    (booking.status !== "pending" && booking.status !== "confirmed")
  ) {
    return null;
  }

  return (
    <div className={styles.section}>
      <ConfirmPopup
        label="Отменить бронирование"
        confirmLabel="Отменить бронь"
        description="Заявка будет отменена, а место снова станет доступно."
        pending={cancelBooking.isPending}
        destructive
        className={MIN_TARGET}
        onConfirm={() =>
          cancelBooking.mutate(booking.id, {
            onSuccess: () =>
              haptic.success(),
          })
        }
      />
      {cancelBooking.error && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(cancelBooking.error)}
        </Notice>
      )}
    </div>
  );
}

/**
 * Цена и основное действие — внизу формы, без плавающего поведения.
 */
export function BookingBar({
  item,
  canBook,
  effectiveSeat,
  createBooking,
  onSubmit,
}: {
  item: Trip;
  canBook: boolean;
  effectiveSeat: number | null;
  createBooking: ReturnType<typeof useCreateBookingMutation>;
  onSubmit: () => void;
}) {
  if (!canBook) return null;

  return (
    <div className={styles.bookBar}>
      <div className={styles.bookBarRow}>
        <div>
          <Caption Component="div">Цена за место</Caption>
          <Headline weight="1" Component="div">
            {item.price} ₽
          </Headline>
        </div>
        <Caption Component="div" className={styles.payHint}>
          {effectiveSeat !== null ? `Место №${effectiveSeat}` : "Выберите место"}
        </Caption>
      </div>
      <Button
        variant="primary"
        size="l"
        stretched
        loading={createBooking.isPending}
        disabled={effectiveSeat === null || createBooking.isPending}
        onClick={onSubmit}
      >
        {effectiveSeat !== null
          ? `Забронировать место №${effectiveSeat}`
          : "Забронировать место"}
      </Button>
      {createBooking.error && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(createBooking.error)}
        </Notice>
      )}
    </div>
  );
}
