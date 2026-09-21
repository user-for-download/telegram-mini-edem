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
import { useToast } from "@/components/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import {
  useDriverRequestsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
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
          toast.show({ text: bookingErrorMessage(error) });
        },
      },
    );
  };

  if (query.isLoading && pending.length === 0) {
    return (
      <div
        role="status"
        aria-label="Загрузка заявок"
        className={styles.requestsList}
        onClick={(event) => event.stopPropagation()}
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
      <div
        className={styles.requestsList}
        onClick={(event) => event.stopPropagation()}
      >
        <Caption Component="p" role="alert" className={styles.requestError}>
          {bookingErrorMessage(query.error)}
        </Caption>
        <Button
          size="s"
          mode="bezeled"
          onClick={() => void query.refetch()}
        >
          Повторить
        </Button>
      </div>
    );
  }

  if (pending.length === 0) return null;

  return (
    <div
      className={styles.requestsList}
      onClick={(event) => event.stopPropagation()}
    >
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
                  act(booking.id, booking.passenger.name, "declined");
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
                  act(booking.id, booking.passenger.name, "confirmed");
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
  );
}
