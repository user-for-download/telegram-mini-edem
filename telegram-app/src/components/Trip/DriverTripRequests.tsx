import {
  Avatar,
  Caption,
  Cell,
  Skeleton,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Notice } from "@/ui/Notice";

import { Armchair, Check, X } from "lucide-react";
import { haptic } from "@/utils/haptics";
import { nativeConfirm } from "@/utils/telegram-adapter";
import { useToast } from "@/components/Toast/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
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
 * Клики гасят всплытие (строки живут внутри кликабельной карточки).
 *
 * Решение по заявке — через нативный popup (nativeConfirm): в браузере
 * (dev) действие выполняется сразу, без подтверждения. Диалога-«досье»
 * больше нет, поэтому комментарий пассажира виден прямо в строке.
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

  // Подтверждение — нативный popup клиента (в dev-браузере действие
  // выполняется сразу). Отклонить — destructive (красная кнопка).
  const askAndAct = async (
    booking: Booking,
    status: "confirmed" | "declined",
  ) => {
    haptic.light();
    const confirmed =
      await nativeConfirm({
        title:
          status === "confirmed"
            ? "Подтвердить пассажира?"
            : "Отклонить заявку?",
        message: `${booking.passenger.name} · место №${booking.seat}`,
        confirmText: status === "confirmed" ? "Подтвердить" : "Отклонить",
        destructive: status === "declined",
      });
    if (!confirmed) return;
    act(booking.id, booking.passenger.name, status);
  };

  const act = (
    id: string,
    passengerName: string,
    status: "confirmed" | "declined",
  ) => {
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
        <Notice role="alert" tone="danger" variant="text">
          {bookingErrorMessage(query.error)}
        </Notice>
        <Button
          size="s"
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

  // F7: пустой список (нет pending на этот tripId — чужой tripId
  // отфильтрован выше) — null без заголовка/счётчика. Общий запрос
  // useDriverRequestsQuery shared с Главной, take не увеличиваем.
  if (pending.length === 0) return null;

  // Кнопки −/+ гасят всплытие сами. Обёртка с onClick запрещена jsx-a11y.
  return (
      <div className={styles.requestsList}>
        {updateStatus.error && (
          <Notice role="alert" tone="danger" variant="text">
            {bookingErrorMessage(updateStatus.error)}
          </Notice>
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
              {booking.comment?.trim()
                ? ` · «${booking.comment.trim()}»`
                : ""}
            </Caption>
          }
          after={
            <span className={styles.requestActions}>
              <IconButton
                size="s"
                aria-label={`Отклонить заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                className={styles.declineIcon}
                onClick={(event) => {
                  event.stopPropagation();
                  void askAndAct(booking, "declined");
                }}
              >
                <X size={18} />
              </IconButton>
              <IconButton
                variant="secondary"
                size="s"
                aria-label={`Принять заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void askAndAct(booking, "confirmed");
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
