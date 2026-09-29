import { Badge, InlineButtons } from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { CarFront, Inbox, Ticket } from "lucide-react";
import { haptic } from "@/utils/haptics";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import {
  useDriverRequestsQuery,
  useMyBookingsQuery,
} from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import { splitBookingsByStatus } from "@/utils/bookingSplit";
import styles from "./TripCountersSection.module.css";

/**
 * Сводка-счётчики на главной: нативный ряд квадратных кнопок
 * (InlineButtons gray, без общего фона). Плашки показываем всегда,
 * даже при нулях; при загрузке — скелетон той же высоты, при ошибке —
 * один Notice с кнопкой «Повторить». Заменяет карточные секции главной
 * (карточки живут на /bookings):
 * 1) «Поездки» — активные за рулём (синий бейдж). Счётчик — точный total
 *    первой страницы useInfiniteMyTripsQuery (бэкенд считает count с тем же
 *    where, а не длину загруженных items: limit 20 врёт при >20 поездок);
 *    фолбэк — длина загруженных items;
 * 2) «Брони» — один counter: есть заявки — красным их число,
 *    иначе синим общее;
 * 3) «Заявки» — pending на мои поездки (красный при count > 0).
 */
export function TripCountersSection() {
  const navigate = useNavigate();
  const bookingsQuery = useMyBookingsQuery();
  const driverTrips = useInfiniteMyTripsQuery({ status: "active" });
  const requestsQuery = useDriverRequestsQuery();

  const bookings = bookingsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];

  const isLoading =
    bookingsQuery.isLoading || driverTrips.isLoading || requestsQuery.isLoading;

  if (isLoading) {
    // Скелетон той же высоты вместо return null (иначе CLS: контент
    // прыгает, когда плашки доезжают). Три серые болванки ≈ высоте
    // InlineButtons.Item, без внешних отступов.
    return (
      <div
        role="status"
        aria-label="Загрузка сводки"
        className={styles.skeletonRow}
      >
        <div aria-hidden className={styles.skeletonTile} />
        <div aria-hidden className={styles.skeletonTile} />
        <div aria-hidden className={styles.skeletonTile} />
      </div>
    );
  }

  const firstError =
    bookingsQuery.error ?? driverTrips.error ?? requestsQuery.error;
  const isError =
    bookingsQuery.isError || driverTrips.isError || requestsQuery.isError;

  if (isError) {
    // Ошибка — не «0»: плашки не рендерим, показываем один Notice
    // с текстом первой ошибки и повтором всех трёх запросов.
    return (
      <div className={styles.error}>
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(firstError)}
        </Notice>
        <Button
          size="s"
          onClick={() => {
            haptic.light();
            void bookingsQuery.refetch();
            void driverTrips.refetch();
            void requestsQuery.refetch();
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  const ownTrips =
    driverTrips.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  // Точный total с бэкенда (count с тем же where), а не длина загруженных
  // страниц: при limit 20 и >20 поездках ownTrips.length врёт.
  const tripsTotal =
    driverTrips.data?.pages[0]?.pagination.total ?? ownTrips.length;
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
      onClick={() => go("/bookings?segment=driving")}
      aria-label={`Ваши поездки, активных: ${tripsTotal}`}
    >
      <span className={styles.iconBadge}>
        <CarFront size={24} />
        <Badge
          type="number"
          mode={tripsTotal === 0 ? "white" : undefined}
          className={styles.badge}
        >
          {tripsTotal}
        </Badge>
      </span>
    </InlineButtons.Item>,
    <InlineButtons.Item
      key="bookings"
      text={showPending ? "Ожидают" : "Брони"}
      onClick={() => go("/bookings?segment=bookings")}
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
      onClick={() => go("/bookings?segment=requests")}
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

  // Без Card-фона: кнопки gray сами несут подложку. Внешних отступов у
  // блока больше нет — рельс (бока 16) и вертикальный ритм (12) даёт
  // корень экрана (ui/Page, токены --app-* в src/index.css).
  // children спредом: JSX считает массив одним ребёнком и ругается на тип
  // (нужен именно массив Item'ов).
  return <InlineButtons mode="gray" {...{ children: items }} />;
}
