import { Badge, InlineButtons } from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { CarFront, Inbox, Ticket } from "lucide-react";
import { haptic } from "@/utils/haptics";
import {
  useDriverRequestsQuery,
  useMyBookingsQuery,
} from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import { splitBookingsByStatus } from "@/utils/bookingSplit";
import styles from "./TripCountersSection.module.css";

/**
 * Сводка-счётчики на главной: нативный ряд квадратных кнопок
 * (InlineButtons gray, без общего фона). Плашки показываем всегда
 * информация). Заменяет карточные секции главной (карточки живут
 * на /bookings):
 * 1) «Поездки» — активные за рулём (синий бейдж);
 * 2) «Брони» — один counter: есть заявки — красным их число,
 *    иначе синим общее;
 * 3) «Заявки» — pending на мои поездки (красный при count > 0).
 */
export function TripCountersSection() {
  const navigate = useNavigate();
  const { data: bookings = [], isLoading: bookingsLoading } =
    useMyBookingsQuery();
  const driverTrips = useInfiniteMyTripsQuery({ status: "active" });
  const { data: requests = [], isLoading: requestsLoading } =
    useDriverRequestsQuery();

  if (bookingsLoading || driverTrips.isLoading || requestsLoading) return null;

  const ownTrips =
    driverTrips.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const { confirmed, pending } = splitBookingsByStatus(bookings, new Date());
  const pendingCount = pending.length;
  const showPending = pendingCount > 0;
  const bookingsValue = showPending ? pendingCount : confirmed.length;

  const go = (to: string) => {
    haptic.light();
    navigate(to);
  };

  // InlineButtons требует детей-элементов (без false от &&) — массив Item'ов.
  const items: React.ReactElement<
    React.ComponentProps<typeof InlineButtons.Item>
  >[] = [
    <InlineButtons.Item
      key="trips"
      text="Поездки"
      onClick={() => go("/bookings?segment=active")}
      aria-label={`Ваши поездки, активных: ${ownTrips.length}`}
    >
      <span className={styles.iconBadge}>
        <CarFront size={24} />
        <Badge
          type="number"
          mode={ownTrips.length === 0 ? "white" : undefined}
          className={styles.badge}
        >
          {ownTrips.length}
        </Badge>
      </span>
    </InlineButtons.Item>,
    <InlineButtons.Item
      key="bookings"
      text={showPending ? "Ожидают" : "Брони"}
      onClick={() => go("/bookings?segment=active")}
      aria-label={`Ваши брони, подтверждено: ${confirmed.length}, ожидает: ${pendingCount}`}
    >
      <span className={styles.iconBadge}>
        <Ticket size={24} />
        <Badge
          type="number"
          mode={
            bookingsValue === 0 ? "white" : showPending ? "critical" : undefined
          }
          className={styles.badge}
        >
          {bookingsValue}
        </Badge>
      </span>
    </InlineButtons.Item>,
    <InlineButtons.Item
      key="requests"
      text="Заявки"
      onClick={() => go("/bookings?segment=active")}
      aria-label={`Заявки пассажиров, новых: ${requests.length}`}
    >
      <span className={styles.iconBadge}>
        <Inbox size={24} />
        <Badge
          type="number"
          mode={requests.length === 0 ? "white" : "critical"}
          className={styles.badge}
        >
          {requests.length}
        </Badge>
      </span>
    </InlineButtons.Item>,
  ];

  return (
    // Без Card-фона: кнопки gray сами несут подложку, обёртка — только отступы.
    <div className={styles.row}>
      {/* children спредом: JSX считает массив одним ребёнком и ругается
          на тип (нужен именно массив Item'ов). */}
      <InlineButtons mode="gray" {...{ children: items }} />
    </div>
  );
}
