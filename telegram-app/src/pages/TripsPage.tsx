import {
  Button,
  Caption,
  TabsList,
  Tappable,
  Text,
} from "@telegram-apps/telegram-ui";
import { ActiveBookingCard } from "@/components/Trip/ActiveBookingCard";
import { DriverTripCard } from "@/components/Trip/DriverTripCard";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { useToast } from "@/components/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { shareTrip } from "@/helpers/tripShare";
import { haptic } from "@/utils/haptics";
import { dayLabel } from "@/utils/date";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import {
  useCancelBookingMutation,
  useMyBookingsQuery,
  usePassengerHistoryQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
  useInfiniteMyTripsQuery,
} from "@/queries/useTripsQuery";
import type { Trip } from "@edem/contracts";
import type { PassengerBooking } from "@edem/contracts";
import styles from "./TripsPage.module.css";

type Segment = "active" | "history";

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "history", label: "История" },
];

function parseSegment(value: string | null): Segment {
  // Легаси ?segment=driver (старые редиректы) — теперь часть «Активных».
  return value === "history" ? "history" : "active";
}

/** Единый статус истории для пассажира и водителя: завершена / отменена. */
function historyCategoryOf(
  item:
    | { kind: "booking"; booking: PassengerBooking }
    | { kind: "driving"; trip: Trip },
): "completed" | "cancelled" | "other" {
  if (item.kind === "driving") {
    if (item.trip.status === "completed") return "completed";
    if (item.trip.status === "cancelled") return "cancelled";
    return "other";
  }
  const known = item.booking.historyCategory;
  if (known === "completed" || known === "cancelled") return known;
  if (
    item.booking.status === "cancelled" ||
    item.booking.status === "declined"
  ) {
    return "cancelled";
  }
  return "other";
}

/**
 * «Поездки» — два раздела: «Активные» (брони + поездки за рулём)
 * и «История» (завершённые/отменённые обеих ролей с фильтром по статусу).
 * Сегмент синхронизирован с ?segment= (?segment=driver — легаси, ведёт
 * в «Активные»; deep-links/редиректы со старых маршрутов).
 */
export function TripsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const segment = parseSegment(searchParams.get("segment"));

  const bookings = useMyBookingsQuery({ enabled: segment === "active" });
  const history = usePassengerHistoryQuery({ enabled: segment === "history" });
  const driverActive = useInfiniteMyTripsQuery({
    status: "active",
    enabled: segment === "active",
  });
  const driverArchive = useInfiniteMyTripsQuery({
    status: "archive",
    enabled: segment === "history",
  });
  const cancelBooking = useCancelBookingMutation();
  const cancelTrip = useCancelTripMutation();
  const completeTrip = useCompleteTripMutation();

  const activeBookings = (bookings.data ?? [])
    .filter(
      (booking) =>
        booking.status === "pending" || booking.status === "confirmed",
    )
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return aTime - bTime;
    });

  const activeDriverTrips =
    driverActive.data?.pages.flatMap((page) => page.items) ?? [];

  type HistoryItem =
    | { kind: "booking"; key: string; at: number; booking: PassengerBooking }
    | { kind: "driving"; key: string; at: number; trip: Trip };

  const tripTime = (trip: {
    departureAt?: string;
    date: string;
    time: string;
  }): number => {
    if (trip.departureAt) {
      const parsed = Date.parse(trip.departureAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const fallback = Date.parse(`${trip.date}T${trip.time}`);
    return Number.isNaN(fallback) ? 0 : fallback;
  };

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

  // Сентинелы автодогрузки водительских поездок (контракт
  // useInfiniteMyTripsQuery не меняется; SSR — тихий фолбэк).
  const activeSentinelRef = useInfiniteSentinel({
    hasNextPage: driverActive.hasNextPage,
    isFetchingNextPage: driverActive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverActive.fetchNextPage();
    },
    disabled: segment !== "active",
  });
  const archiveSentinelRef = useInfiniteSentinel({
    hasNextPage: driverArchive.hasNextPage,
    isFetchingNextPage: driverArchive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverArchive.fetchNextPage();
    },
    disabled: segment !== "history",
  });

  const pickSegment = (next: Segment) => {
    if (next === segment) return;
    haptic.selection();
    setSearchParams(next === "active" ? {} : { segment: next }, {
      replace: true,
    });
  };

  const mutationError =
    cancelBooking.error ?? cancelTrip.error ?? completeTrip.error;

  return (
    <div className={styles.page}>
      <TabsList>
        {SEGMENTS.map((option) => (
          <TabsList.Item
            key={option.value}
            selected={segment === option.value}
            onClick={() => pickSegment(option.value)}
          >
            {option.label}
          </TabsList.Item>
        ))}
      </TabsList>

      {mutationError && (
        <Caption Component="p" role="alert" className={styles.alert}>
          {bookingErrorMessage(mutationError)}
        </Caption>
      )}

      {segment === "active" && (
        <QueryState
          loading={bookings.isLoading || driverActive.isLoading}
          error={bookings.error ?? driverActive.error}
          empty={activeBookings.length === 0 && activeDriverTrips.length === 0}
          emptyText="Пока тихо: забронируйте поездку или опубликуйте свой маршрут!"
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void bookings.refetch();
            void driverActive.refetch();
          }}
        >
          <div className={styles.list}>
            {activeBookings.map((booking) => (
              <ActiveBookingCard
                key={booking.id}
                booking={booking}
                pending={cancelBooking.isPending}
                onCancel={(id) =>
                  cancelBooking.mutate(id, {
                    onSuccess: () => {
                      haptic.success();
                      toast.show({ text: "Бронь поездки отменена" });
                    },
                  })
                }
              />
            ))}
            {activeDriverTrips.map((trip) => (
              <DriverTripCard
                key={trip.id}
                trip={trip}
                archived={false}
                onRequests={(id) => navigate(`/trips/my/${id}/requests`)}
                onManage={(id) => {
                  haptic.light();
                  navigate(`/trips/${id}`);
                }}
                onShare={(id) => {
                  haptic.light();
                  void shareTrip(id);
                }}
                onComplete={(id) =>
                  completeTrip.mutate(id, {
                    onSuccess: () => {
                      haptic.success();
                      toast.show({ text: "Поездка завершена" });
                    },
                  })
                }
                onCancel={(id) =>
                  cancelTrip.mutate(id, {
                    onSuccess: () => {
                      haptic.warning();
                      toast.show({ text: "Поездка отменена" });
                    },
                  })
                }
                completePending={completeTrip.isPending}
                cancelPending={cancelTrip.isPending}
              />
            ))}
            {driverActive.hasNextPage && (
              <>
                <div
                  ref={activeSentinelRef}
                  aria-hidden="true"
                  className={styles.sentinel}
                />
                {driverActive.isFetchingNextPage && (
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
                  loading={driverActive.isFetchingNextPage}
                  disabled={driverActive.isFetchingNextPage}
                  onClick={() => void driverActive.fetchNextPage()}
                >
                  Показать ещё
                </Button>
              </>
            )}
            <Button size="l" mode="bezeled" onClick={() => navigate("/trips")}>
              Найти поездку
            </Button>
            <Button
              size="l"
              mode="bezeled"
              onClick={() => navigate("/trips/my/new")}
            >
              + Создать поездку
            </Button>
          </div>
        </QueryState>
      )}

      {segment === "history" && (
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
          <div className={`${styles.list} ${styles.listSpaced}`}>
            {historyItems.map((item) => {
              if (item.kind === "driving") {
                return (
                  <DriverTripCard
                    key={item.key}
                    trip={item.trip}
                    archived
                    onRequests={() => {}}
                    onManage={(id) => {
                      haptic.light();
                      navigate(`/trips/${id}`);
                    }}
                    onShare={() => {}}
                    onComplete={() => {}}
                    onCancel={() => {}}
                    completePending={false}
                    cancelPending={false}
                  />
                );
              }
              const booking = item.booking;
              const category = historyCategoryOf(item);
              return (
                <Tappable
                  Component="button"
                  key={item.key}
                  type="button"
                  onClick={() => {
                    haptic.light();
                    navigate(`/trips/${booking.trip.id}`);
                  }}
                  className={styles.archived}
                >
                  <Caption className={styles.archivedHead} Component="div">
                    <span>{dayLabel(booking.trip.date)}</span>
                    <Text
                      weight="2"
                      Component="span"
                      className={
                        category === "completed"
                          ? styles.success
                          : styles.danger
                      }
                    >
                      {category === "completed"
                        ? "Поездка завершена"
                        : "Поездка отменена"}
                    </Text>
                  </Caption>
                  <Text weight="2" Component="div">
                    {booking.trip.fromCity} → {booking.trip.toCity}
                  </Text>
                  <Caption className={styles.archivedRow} Component="div">
                    <span className={styles.truncate}>
                      Водитель: {booking.trip.driver.name}
                    </span>
                    <Text weight="2" Component="span" className={styles.shrink}>
                      {`взнос ~${booking.trip.price} ₽`}
                    </Text>
                  </Caption>
                </Tappable>
              );
            })}
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
          </div>
        </QueryState>
      )}
    </div>
  );
}
