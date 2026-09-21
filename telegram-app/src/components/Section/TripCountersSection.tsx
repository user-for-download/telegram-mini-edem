import { Badge, Card, InlineButtons } from "@telegram-apps/telegram-ui";
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
 * (InlineButtons bezeled), каждая — только при count > 0, иначе вся
 * секция скрыта. Заменяет карточные секции главной (карточки живут
 * на /bookings):
 * 1) «Поездки» — активные за рулём (синий бейдж);
 * 2) «Брони» — один counter: есть заявки — красным их число,
 *    иначе синим общее;
 * 3) «Заявки» — pending на мои поездки (красный).
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

  const go = (to: string) => {
    haptic.light();
    navigate(to);
  };

  const hasRows =
    ownTrips.length > 0 ||
    confirmed.length + pendingCount > 0 ||
    requests.length > 0;
  if (!hasRows) return null;

  // InlineButtons требует детей-элементов (без false от &&) — собираем массив.
  const items: React.ReactElement<
    React.ComponentProps<typeof InlineButtons.Item>
  >[] = [];
  if (ownTrips.length > 0) {
    items.push(
      <InlineButtons.Item
        key="trips"
        text="Поездки"
        onClick={() => go("/bookings?segment=active")}
        aria-label={`Ваши поездки, активных: ${ownTrips.length}`}
      >
        <span className={styles.iconBadge}>
          <CarFront size={24} />
          <Badge type="number" className={styles.badge}>
            {ownTrips.length}
          </Badge>
        </span>
      </InlineButtons.Item>,
    );
  }
  if (confirmed.length + pendingCount > 0) {
    items.push(
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
            mode={showPending ? "critical" : undefined}
            className={styles.badge}
          >
            {showPending ? pendingCount : confirmed.length}
          </Badge>
        </span>
      </InlineButtons.Item>,
    );
  }
  if (requests.length > 0) {
    items.push(
      <InlineButtons.Item
        key="requests"
        text="Заявки"
        onClick={() => go("/bookings?segment=active")}
        aria-label={`Заявки пассажиров, новых: ${requests.length}`}
      >
        <span className={styles.iconBadge}>
          <Inbox size={24} />
          <Badge type="number" mode="critical" className={styles.badge}>
            {requests.length}
          </Badge>
        </span>
      </InlineButtons.Item>,
    );
  }

  return (
    <Card type="plain" className={styles.card}>
      {/* children спредом: JSX считает массив одним ребёнком и ругается
          на тип (нужен именно массив Item'ов). */}
      <InlineButtons mode="bezeled" {...{ children: items }} />
    </Card>
  );
}
