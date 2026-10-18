import {
  Badge,
  IconContainer,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { FetchMore } from "@/ui/FetchMore";
import { Section } from "@/ui/Section";
import { Cell } from "@/ui/Cell";
import { Page } from "@/ui/Page";

import { useNavigate } from "react-router-dom";
import { useOpenTrip } from "@/hooks/useOpenTrip";
import { CarFront, CircleUserRound } from "lucide-react";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { haptic } from "@/utils/haptics";
import { relativeMoscowDay } from "@/utils/date";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { listBlockingError } from "@/helpers/listBlockingError";
import { usePassengerHistoryQuery } from "@/queries/useBookingsQuery";
import { useInfiniteMyTripsQuery } from "@/queries/useTripsQuery";
import type { Trip } from "@edem/contracts";
import type { PassengerBooking } from "@edem/contracts";
import { terminalTripStatusLabel } from "@/utils/tripStatus";
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
 * Тон терминального статуса: завершена — success, отменена — danger,
 * архив («В архиве») — без тона (приглушённый текст).
 */
type HistoryStatusTone = "success" | "danger" | null;

function terminalTone(status: Trip["status"] | undefined): HistoryStatusTone {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  return null;
}

/**
 * Статус строки истории: текст (единственный источник — `terminalTripStatusLabel`)
 * и тон для подкраски. Пассажир — по historyCategory бэкенда; водитель — по
 * статусу поездки. Смысл всегда в словах: цвет — подсказка (a11y: color + text).
 */
function historyStatus(item: HistoryItem): {
  label: string;
  tone: HistoryStatusTone;
} {
  if (item.kind === "driving") {
    return {
      label: terminalTripStatusLabel(item.trip.status) ?? "В архиве",
      tone: terminalTone(item.trip.status),
    };
  }
  const category = item.booking.historyCategory;
  if (category === "completed") return { label: "Завершена", tone: "success" };
  if (
    category === "cancelled" ||
    item.booking.status === "cancelled" ||
    item.booking.status === "declined"
  ) {
    return { label: "Отменена", tone: "danger" };
  }
  return { label: "В архиве", tone: null };
}

/**
 * История поездок: простые Cell (без карточек).
 * Водитель — иконка машины, пассажир — иконка человечка.
 * Топ-level страница: корень — Page (кит), состояния — QueryState
 * (пусто — через EmptyState-обёртку). Отступы как везде (бока 8,
 * вертикаль 12).
 */
export function TripHistoryPage() {
  const navigate = useNavigate();
  const openTrip = useOpenTrip();

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
    // После сбоя страницы N+1 hasNextPage остаётся истинным — сентинел без
    // глушения зацикливал бы запросы вслед за плейсхолдером (MEMORY.md:511).
    disabled: driverArchive.isFetchNextPageError,
    fetchNextPage: () => {
      void driverArchive.fetchNextPage();
    },
  });

  const open = (id: string) => {
    haptic.light();
    openTrip(id);
  };

  return (
    <Page>
      {/* NavHeader помечен aria-hidden («авторитетные h1 живут на страницах») —
          имя экрана даёт скрытый h1. */}
      <VisuallyHidden Component="h1">История поездок</VisuallyHidden>
      <QueryState
        loading={history.isLoading || driverArchive.isLoading}
        error={history.error ?? listBlockingError(driverArchive)}
        empty={historyItems.length === 0}
        emptyText={EMPTY_STATES.tripHistory.description}
        skeleton={<TripCardsSkeleton />}
        onRetry={() => {
          void history.refetch();
          void driverArchive.refetch();
        }}
      >
        {historyItems.length > 0 && (
          // Как лента заявок на главной: нативный Section — строки идут
          // сплошняком с hairline-разделителями, без гэпов.
          <Section>
            {historyItems.map((item) => {
              const trip =
                item.kind === "driving" ? item.trip : item.booking.trip;
              // Отзыв нужен только пассажиру с canReview — красный counter,
              // иначе серый бейдж с ценой.
              const needReview =
                item.kind === "booking" && item.booking.canReview === true;
              const status = historyStatus(item);
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
                  subtitle={`${relativeMoscowDay(trip.departureAt)}, ${trip.time}`}
                  /* Строка 3 — статус тоном: та же трёхстрочная раскладка, что у
                     уведомлений и жалоб. Раньше статус был приклеен к дате
                     (`subtitle`) и обрезался в «Отме…»/«Заверш…» — ключевое
                     слово не читалось. */
                  description={
                    <span
                      className={styles.status}
                      data-tone={status.tone ?? undefined}
                      data-testid={`history-status-${item.key}`}
                    >
                      {status.label}
                    </span>
                  }
                  after={
                    needReview ? (
                      <Badge type="number" mode="critical">
                        1
                      </Badge>
                    ) : (
                      <span className={styles.price}>{`${trip.price} ₽`}</span>
                    )
                  }
                  // needReview ведёт на /reviews, а не в карточку: красный
                  // бейдж и aria-label обещали «оставьте отзыв», а карточка
                  // поездки кнопки отзыва не содержит — обещание было
                  // неисполнимым, и единственный путь к отзыву оставался
                  // недостижимым с этой подсказки.
                  onClick={() =>
                    needReview ? navigate("/reviews") : open(trip.id)
                  }
                  aria-label={
                    // Имя строки = все её видимые части, как в ui/MenuRow:66
                    // (`${label}. ${subtitle}`). aria-label ЗАМЕНЯет доступное
                    // имя, поэтому дата-время (subtitle) и цена/бейдж (after)
                    // иначе были недостижимы: скринридер не мог сказать, КОГДА
                    // поездка и СКОЛЬКО стоила.
                    `Поездка ${trip.fromCity} — ${trip.toCity}. ${relativeMoscowDay(
                      trip.departureAt,
                    )}, ${trip.time}. ${status.label}. ${
                      needReview ? "Оставьте отзыв" : `${trip.price} ₽`
                    }`
                  }
                >
                  {trip.fromCity} → {trip.toCity}
                </Cell>
              );
            })}
          </Section>
        )}
        <FetchMore
          hasNextPage={driverArchive.hasNextPage}
          isFetchingNextPage={driverArchive.isFetchingNextPage}
          fetchNextPage={() => void driverArchive.fetchNextPage()}
          error={
            driverArchive.isFetchNextPageError ? driverArchive.error : null
          }
          sentinelRef={archiveSentinelRef}
          placeholder={<TripCardSkeleton />}
          placeholderLabel="Загрузка ещё поездок"
        />
      </QueryState>
    </Page>
  );
}
