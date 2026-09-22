import {
  Avatar,
  Blockquote,
  Button,
  Caption,
  Cell,
  Modal,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import type { Booking, DriverBookingAction } from "@edem/contracts";
import { RatingPill } from "@/components/RatingPill";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import styles from "./RequestConfirmDialog.module.css";

export type { DriverBookingAction };

/**
 * Окно подтверждения решения водителя по заявке: досье пассажира
 * (аватар, ФИО, место, комментарий к поездке) + Да/Нет.
 * Один компонент на оба места: строки в карточке (DriverTripRequests)
 * и страница заявок (TripRequestsModal).
 * Подтверждение деструктива — всегда filled, «Назад» — bezeled
 * (исключение из «всё bezeled», как в ConfirmAction).
 */
export function RequestConfirmDialog({
  booking,
  action,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  action: DriverBookingAction;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Динамический заголовок (подтвердить/отклонить): одно имя диалога —
  // тот же titleId в aria-labelledby, текст — по action.
  const titleId = useSheetTitleId();
  const title =
    action === "confirmed" ? "Подтвердить пассажира?" : "Отклонить заявку?";
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>{title}</Modal.Header>}
      aria-labelledby={titleId}
    >
      <div className={styles.body}>
        <SheetTitle titleId={titleId}>{title}</SheetTitle>
        <RequestConfirmBody
          booking={booking}
          action={action}
          pending={pending}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </div>
    </Modal>
  );
}

/** Тело диалога (экспортировано для SSR-тестов: Modal — портал, в renderToString не попадает). */
export function RequestConfirmBody({
  booking,
  action,
  pending,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  action: DriverBookingAction;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const comment = booking.comment?.trim() ? booking.comment : "Без комментария";
  return (
    <div className={styles.form}>
      <Cell
        className={styles.person}
        before={
          <Avatar
            size={48}
            src={booking.passenger.avatar}
            acronym={booking.passenger.name.slice(0, 2).toUpperCase()}
          />
        }
        subtitle={`место №${booking.seat}`}
        after={
          <RatingPill size="m" value={booking.passenger.rating ?? null} />
        }
      >
        <Subheadline level="2" Component="p" weight="1">
          {booking.passenger.name}
        </Subheadline>
      </Cell>
      <div>
        <Caption level="1" Component="p" weight="2">
          Комментарий пассажира
        </Caption>
        <Blockquote type="text" className={styles.quote}>
          {comment}
        </Blockquote>
      </div>
      <Button
        mode="filled"
        size="l"
        stretched
        className="min-h-11"
        loading={pending}
        disabled={pending}
        onClick={onConfirm}
      >
        {action === "confirmed" ? "Подтвердить" : "Отклонить"}
      </Button>
      <Button
        mode="bezeled"
        size="l"
        stretched
        className="min-h-11"
        disabled={pending}
        onClick={onClose}
      >
        Назад
      </Button>
    </div>
  );
}
