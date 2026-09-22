import {
  Badge,
  Button,
  Cell,
  IconContainer,
  Section,
} from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { CarFront, CircleUserRound } from "lucide-react";
import { QueryState } from "@/components/QueryState";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { haptic } from "@/utils/haptics";
import { dayLabel } from "@/utils/date";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { usePassengerHistoryQuery } from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import type { Trip } from "@edem/contracts";
import type { PassengerBooking } from "@edem/contracts";
import styles from "./TripHistoryPage.module.css";

type HistoryItem =
  | { kind: "booking"; key: string; at: number; booking: PassengerBooking }
  | { kind: "driving"; key: string; at: number; trip: Trip };

function tripTime(trip: {
  departureAt?: string;
  date: string;
  time: string;
}): number {
  if (trip.departureAt) {
    const parsed = Date.parse(trip.departureAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const fallback = Date.parse(`${trip.date}T${trip.time}`);
  return Number.isNaN(fallback) ? 0 : fallback;
}

/**
 * Текст статуса строки истории (только текст, без пилюли — раскладка
 * Cell не меняется, смысл не зависит от цвета).
 * Пассажир — по historyCategory бэкенда; водитель — по статусу поездки.
 */
function historyStatusLabel(item: HistoryItem): string {
  if (item.kind === "driving") {
    if (item.trip.status === "completed") return "Завершена";
    if (item.trip.status === "cancelled") return "Отменена";
    return "В архиве";
  }
  const category = item.booking.historyCategory;
  if (category === "completed") return "Завершена";
  if (category === "cancelled") return "Отменена";
  if (
    item.booking.status === "cancelled" ||
    item.booking.status === "declined"
  ) {
    return "Отменена";
  }
  return "В архиве";
}

/**
 * История поездок: простые Cell (без карточек).
 * Водитель — иконка машины, пассажир — иконка человечка.
 * Отступы как везде (бока 8, вертикаль 12).
 */
export function TripHistoryPage() {
  const navigate = useNavigate();

  const history = usePassengerHistoryQuery();
  const driverArchive = useInfiniteMyTripsQuery({ status: "archive" });

  const historyItems: HistoryItem[] = [
    ...(history.data ?? []).map((booking) => ({
      kind: "booking" as const,
      key: `b-${booking.id}`,
      at: tripTime(booking.trip),
      booking,
    })),
    ...(driverArchive.data?.pages.flatMap((page) => page.items) ?? []).map(
      (trip) => ({
        kind: "driving" as const,
        key: `d-${trip.id}`,
        at: tripTime(trip),
        trip,
      }),
    ),
  ].sort((a, b) => b.at - a.at);

  const archiveSentinelRef = useInfiniteSentinel({
    hasNextPage: driverArchive.hasNextPage,
    isFetchingNextPage: driverArchive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverArchive.fetchNextPage();
    },
  });

  const open = (id: string) => {
    haptic.light();
    navigate(`/trips/${id}`);
  };

  return (
    <QueryState
      loading={history.isLoading || driverArchive.isLoading}
      error={history.error ?? driverArchive.error}
      empty={historyItems.length === 0}
      emptyText="Здесь появятся завершённые и отменённые поездки."
      skeleton={<TripCardsSkeleton />}
      onRetry={() => {
        void history.refetch();
        void driverArchive.refetch();
      }}
    >
      {historyItems.length > 0 && (
        // Как «Популярные направления»: нативный Section — строки идут
        // сплошняком с hairline-разделителями, без гэпов.
        <Section>
          {historyItems.map((item) => {
            const trip =
              item.kind === "driving" ? item.trip : item.booking.trip;
            // Отзыв нужен только пассажиру с canReview — красный counter,
            // иначе серый бейдж с ценой.
            const needReview =
              item.kind === "booking" && item.booking.canReview === true;
            const status = historyStatusLabel(item);
            return (
              <Cell
                key={item.key}
                Component="button"
                type="button"
                before={
                  <IconContainer>
                    {item.kind === "driving" ? (
                      <CarFront size={22} />
                    ) : (
                      <CircleUserRound size={22} />
                    )}
                  </IconContainer>
                }
                subtitle={`${dayLabel(trip.date)}, ${trip.time} · ${status}`}
                after={
                  needReview ? (
                    <Badge type="number" mode="critical">
                      1
                    </Badge>
                  ) : (
                    <span className={styles.price}>{`${trip.price} ₽`}</span>
                  )
                }
                onClick={() => open(trip.id)}
                aria-label={
                  needReview
                    ? `Поездка ${trip.fromCity} — ${trip.toCity}, ${status}, оставьте отзыв`
                    : `Поездка ${trip.fromCity} — ${trip.toCity}, ${status}`
                }
              >
                {trip.fromCity} → {trip.toCity}
              </Cell>
            );
          })}
        </Section>
      )}
      {driverArchive.hasNextPage && (
        <>
          <div
            ref={archiveSentinelRef}
            aria-hidden="true"
            className={styles.sentinel}
          />
          {driverArchive.isFetchingNextPage && (
            <div
              role="status"
              aria-label="Загрузка ещё поездок"
              className={styles.list}
            >
              <TripCardSkeleton />
            </div>
          )}
          <Button
            stretched
            mode="bezeled"
            loading={driverArchive.isFetchingNextPage}
            disabled={driverArchive.isFetchingNextPage}
            onClick={() => void driverArchive.fetchNextPage()}
          >
            Показать ещё
          </Button>
        </>
      )}
    </QueryState>
  );
}
