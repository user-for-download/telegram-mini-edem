import { useState } from "react";
import {
  Avatar,
  Button,
  Caption,
  Cell,
  IconButton,
  Skeleton,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { Armchair, Check, X } from "lucide-react";
import { haptic } from "@/utils/haptics";
import { useModalBack } from "@/utils/modalBack";
import { useToast } from "@/components/Toast/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import {
  RequestConfirmDialog,
  type DriverBookingAction,
} from "@/components/Trip/RequestConfirmDialog";
import {
  useDriverRequestsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import type { Booking } from "@edem/contracts";
import styles from "./TripCards.module.css";

/**
 * Активные заявки на поездку водителя: строки Cell в стиле персоны
 * карточки (аватар 40 + бейдж рейтинга, имя, subline) — аватар
 * пассажира, место и комментарий брони, IconButton «−»/«+» в after.
 * Вместо машины — комментарий пассажира при бронировании.
 * Клики гасят всплытие (строки живут внутри кликабельной карточки).
 *
 * Данные — общий useDriverRequestsQuery (один запрос на все карточки,
 * кэш shared со счётчиками Главной): бэкенд /driver отдаёт только
 * pending на активных будущих поездках (take 50 суммарно — при >50
 * заявок строки обрежутся, точный счётчик — pendingRequestsCount).
 */
export function DriverTripRequests({ tripId }: { tripId: string }) {
  const toast = useToast();
  const query = useDriverRequestsQuery();
  const updateStatus = useUpdateBookingStatusMutation();
  const [confirm, setConfirm] = useState<{
    booking: Booking;
    action: DriverBookingAction;
  } | null>(null);
  // Нативный Back закрывает окно подтверждения, а не страницу.
  useModalBack(() => setConfirm(null), confirm !== null);

  const pending = (query.data ?? []).filter(
    (booking) => booking.trip.id === tripId && booking.status === "pending",
  );

  // Кнопки −/+ блокируем только у обрабатываемой строки.
  const actingId = updateStatus.isPending
    ? updateStatus.variables?.id
    : undefined;

  const act = (
    id: string,
    passengerName: string,
    status: "confirmed" | "declined",
  ) => {
    haptic.light();
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => {
          haptic.success();
          toast.show({
            text:
              status === "confirmed"
                ? `Заявка ${passengerName} принята`
                : `Заявка ${passengerName} отклонена`,
          });
        },
        onError: (error) => {
          haptic.error();
          toast.show({
            text: bookingErrorMessage(error),
            assertive: true,
          });
        },
      },
    );
  };

  // Подтверждение в окне — сразу закрываем его (как ConfirmAction);
  // ошибка видна через тост + инлайн-алерт, строка остаётся для повтора.
  const confirmAction = () => {
    if (!confirm) return;
    const { booking, action } = confirm;
    setConfirm(null);
    act(booking.id, booking.passenger.name, action);
  };

  if (query.isLoading && pending.length === 0) {
    return (
      // Скелетон без действий: всплытие безвредно (тап открывает детали
      // поездки — тот же результат, что и тап по карточке), поэтому
      // stopPropagation-обёртка убрана (запрещена jsx-a11y).
      <div
        role="status"
        aria-label="Загрузка заявок"
        className={styles.requestsList}
      >
        {[0, 1].map((index) => (
          <Skeleton key={index} visible aria-hidden="true">
            <div className={styles.requestSkeletonRow}>
              <span className={styles.requestSkeletonAvatar} />
              <span className={styles.requestSkeletonLines}>
                <span className={styles.requestSkeletonName} />
                <span className={styles.requestSkeletonSeat} />
              </span>
            </div>
          </Skeleton>
        ))}
      </div>
    );
  }

  if (query.error && pending.length === 0) {
    return (
      <div className={styles.requestsList}>
        <Caption Component="p" role="alert" className={styles.requestError}>
          {bookingErrorMessage(query.error)}
        </Caption>
        <Button
          size="s"
          mode="bezeled"
          onClick={(event) => {
            // «Повторить» не должен открывать детали поездки (карточка
            // кликабельна) — гасим всплытие в самой кнопке, а не обёрткой
            // (обёртки с onClick запрещены jsx-a11y).
            event.stopPropagation();
            void query.refetch();
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  if (pending.length === 0) return null;

  // Кнопки −/+ гасят всплытие сами; диалог подтверждения — портал вне
  // обёртки (иначе его клики всплывали бы в карточку). Обёртка с onClick
  // запрещена jsx-a11y (см. ConfirmAction.stop).
  return (
    <>
      <div className={styles.requestsList}>
        {updateStatus.error && (
          <Caption Component="p" role="alert" className={styles.requestError}>
            {bookingErrorMessage(updateStatus.error)}
          </Caption>
        )}
        {pending.map((booking) => (
        <Cell
          key={booking.id}
          className={styles.requestCell}
          before={
            <Avatar
              size={40}
              src={booking.passenger.avatar}
              acronym={booking.passenger.name.slice(0, 2).toUpperCase()}
            >
              {booking.passenger.rating != null && (
                <Avatar.Badge mode="white" type="number">
                  {booking.passenger.rating.toFixed(1)}
                </Avatar.Badge>
              )}
            </Avatar>
          }
          subtitle={
            <Caption level="1" Component="p" weight="2">
              <span className={styles.seat}>
                <Armchair size={14} aria-hidden />
                {`место №${booking.seat}`}
              </span>
            </Caption>
          }
          after={
            <span className={styles.requestActions}>
              <IconButton
                mode="plain"
                size="s"
                aria-label={`Отклонить заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                style={{ color: "var(--tgui--destructive_text_color)" }}
                onClick={(event) => {
                  event.stopPropagation();
                  haptic.light();
                  setConfirm({ booking, action: "declined" });
                }}
              >
                <X size={18} />
              </IconButton>
              <IconButton
                mode="bezeled"
                size="s"
                aria-label={`Принять заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                onClick={(event) => {
                  event.stopPropagation();
                  haptic.light();
                  setConfirm({ booking, action: "confirmed" });
                }}
              >
                <Check size={18} />
              </IconButton>
            </span>
          }
        >
          <Subheadline level="2" Component="p" weight="1">
            {booking.passenger.name}
          </Subheadline>
        </Cell>
      ))}
      </div>
      {confirm && (
        <RequestConfirmDialog
          booking={confirm.booking}
          action={confirm.action}
          open
          pending={updateStatus.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={confirmAction}
        />
      )}
    </>
  );
}
