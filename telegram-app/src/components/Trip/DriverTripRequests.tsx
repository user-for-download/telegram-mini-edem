import {
  Avatar,
  Caption,
  Cell,
  IconButton,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { Armchair, Check, X } from "lucide-react";
import { haptic } from "@/utils/haptics";
import {
  useTripBookingsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import styles from "./TripCards.module.css";

/**
 * Активные заявки на поездку водителя: строки Cell в стиле персоны
 * карточки (аватар 40 + бейдж рейтинга, имя, subline) — аватар
 * пассажира, место и комментарий брони, IconButton «−»/«+» в after.
 * Вместо машины — комментарий пассажира при бронировании.
 * Клики гасят всплытие (карточка — role=button).
 */
export function DriverTripRequests({ tripId }: { tripId: string }) {
  const query = useTripBookingsQuery(tripId);
  const updateStatus = useUpdateBookingStatusMutation();

  const pending = (query?.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((booking) => booking.status === "pending");
  if (pending.length === 0) return null;

  const act = (id: string, status: "confirmed" | "declined") => {
    haptic.light();
    updateStatus.mutate({ id, status });
  };

  return (
    <div
      className={styles.requestsList}
      onClick={(event) => event.stopPropagation()}
    >
      {pending.map((booking) => (
        <Cell
          key={booking.id}
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
                mode="bezeled"
                size="s"
                aria-label={`Отклонить заявку ${booking.passenger.name}`}
                disabled={updateStatus.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  act(booking.id, "declined");
                }}
              >
                <X size={18} />
              </IconButton>
              <IconButton
                mode="bezeled"
                size="s"
                aria-label={`Принять заявку ${booking.passenger.name}`}
                disabled={updateStatus.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  act(booking.id, "confirmed");
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
