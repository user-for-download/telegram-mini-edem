import { Notice } from "@/ui/Notice";
import { FetchMore } from "@/ui/FetchMore";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Page } from "@/ui/Page";

import { useNavigate, useSearchParams } from "react-router-dom";
import { TripCard } from "@/components/Trip/TripCard";
import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Stack } from "@/ui/Stack";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { useToast } from "@/components/Toast/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import {
  useCancelBookingMutation,
  useDriverRequestsQuery,
  useMyBookingsQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useInfiniteMyTripsQuery,
} from "@/queries/useTripsQuery";
import { useProfileQuery } from "@/queries/profile";
import styles from "./TripActivePage.module.css";

type TripSegment = "driving" | "bookings" | "requests";

/**
 * Нормализация ?segment: driving ← {driving, driver (legacy), active
 * (legacy)}; bookings ← {bookings}; requests ← {requests}; всё остальное
 * (включая history — он редиректится в TripPage, но дефолтно) → driving.
 * Не редирект, а нормализация отображения: легаси-ссылки остаются
 * валидными (?segment=driver показывает driving).
 */
function normalizeSegment(raw: string | null): TripSegment {
  if (raw === "bookings") return "bookings";
  if (raw === "requests") return "requests";
  return "driving";
}

/**
 * Активные поездки/брони — топ-level страница (корень Page один,
 * состояния через QueryState/EmptyState-обёртку). Вложенных Page нет:
 * TripPage — лишь совместимость query (?segment=history) без обёртки.
 * Вверху — три чипа-сегмента (как на SearchPage, .chipRow локален,
 * position НЕ sticky): «За рулём» (дефолт, канонический URL — чистый
 * /bookings), «Мои брони», «Заявки». Клик: haptic.selection() +
 * setSearchParams (driving → чистый /bookings, replace).
 *
 * Счётчики — текстом в скобках («Заявки (3)», ноль не показываем):
 * Badge в after кита-чипа не используем (риск SSR/стилей), чипы кита
 * короткие. driving — pages[0].pagination.total ?? длина загруженного
 * (бэкенд отдаёт total честно); bookings — activeBookings.length;
 * requests — сумма pendingRequestsCount по всем activeDriverTrips
 * (точный счётчик бэкенда, а не длина /driver: общий запрос обрезан
 * take 50, строки могут обрезаться — см. DriverTripRequests).
 *
 * QueryState считается ПО СЕГМЕНТУ: driving — driverActive (+ FetchMore),
 * bookings — bookings, requests — driverRequests (+ driverActive для списка
 * поездок: строки DriverTripRequests строятся по поездкам с
 * pendingRequestsCount > 0; empty = totalPending === 0). Скелетон везде —
 * TripCardsSkeleton. Кнопки «Найти/Создать» — только в driving.
 */
export function TripActivePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = normalizeSegment(searchParams.get("segment"));

  const bookings = useMyBookingsQuery();
  const driverActive = useInfiniteMyTripsQuery({ status: "active" });
  const driverRequests = useDriverRequestsQuery();
  const profile = useProfileQuery();
  const cancelBooking = useCancelBookingMutation();
  const cancelTrip = useCancelTripMutation();

  const mutationError = cancelBooking.error ?? cancelTrip.error;

  // Активные — только scope active: бэкенд метит history завершённые
  // и уехавшие (departureAt <= now), даже если бронь confirmed.
  // scope отсутствует только в старых моках — таких не отфильтровываем.
  const activeBookings = (bookings.data ?? [])
    .filter(
      (booking) =>
        (booking.status === "pending" || booking.status === "confirmed") &&
        booking.scope !== "history",
    )
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return aTime - bTime;
    });

  const activeDriverTrips =
    driverActive.data?.pages.flatMap((page) => page.items) ?? [];

  const firstPageTotal = (
    driverActive.data?.pages[0]?.pagination as unknown as {
      total?: unknown;
    } | undefined
  )?.total;
  const drivingTotal =
    typeof firstPageTotal === "number"
      ? firstPageTotal
      : activeDriverTrips.length;
  const requestsTotal = activeDriverTrips.reduce(
    (sum, trip) => sum + (trip.pendingRequestsCount ?? 0),
    0,
  );

  const withCount = (label: string, count: number): string =>
    count > 0 ? `${label} (${count})` : label;

  const selectSegment = (next: TripSegment) => {
    haptic.selection();
    setSearchParams(
      next === "driving" ? {} : { segment: next },
      { replace: true },
    );
  };

  const segmentChip = (id: TripSegment, label: string) => (
    <Chip
      key={id}
      Component="button"
      type="button"
      variant={segment === id ? "active" : "quiet"}
      aria-pressed={segment === id}
      onClick={() => selectSegment(id)}
    >
      {label}
    </Chip>
  );

  const activeSentinelRef = useInfiniteSentinel({
    hasNextPage: driverActive.hasNextPage,
    isFetchingNextPage: driverActive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverActive.fetchNextPage();
    },
  });

  return (
    <Page>
      {mutationError && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(mutationError)}
        </Notice>
      )}
      <div className={styles.chipRow}>
        {segmentChip("driving", withCount("За рулём", drivingTotal))}
        {segmentChip("bookings", withCount("Мои брони", activeBookings.length))}
        {segmentChip("requests", withCount("Заявки", requestsTotal))}
      </div>
      {segment === "bookings" ? (
        <QueryState
          loading={bookings.isLoading}
          error={bookings.error}
          empty={activeBookings.length === 0}
          emptyText={EMPTY_STATES.tripActive.description}
          emptyAction={
            <Button
              size="m"
              onClick={() => {
                haptic.light();
                navigate("/profile/history");
              }}
            >
              История поездок
            </Button>
          }
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void bookings.refetch();
          }}
        >
          <Stack>
            {activeBookings.map((booking) => (
              <TripCard
                key={booking.id}
                variant={{
                  kind: "booking",
                  booking,
                  onCancel: (id) =>
                    cancelBooking.mutate(id, {
                      onSuccess: () => {
                        haptic.success();
                        toast.show({ text: "Бронь поездки отменена" });
                      },
                    }),
                  cancelPending:
                    cancelBooking.isPending &&
                    cancelBooking.variables === booking.id,
                }}
              />
            ))}
          </Stack>
        </QueryState>
      ) : segment === "requests" ? (
        <QueryState
          loading={driverRequests.isLoading || driverActive.isLoading}
          error={driverRequests.error ?? driverActive.error}
          empty={requestsTotal === 0}
          emptyText={EMPTY_STATES.tripRequestsEmpty.header}
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void driverRequests.refetch();
            void driverActive.refetch();
          }}
        >
          <Stack>
            {activeDriverTrips
              .filter((trip) => (trip.pendingRequestsCount ?? 0) > 0)
              .map((trip) => (
                <DriverTripRequests key={trip.id} tripId={trip.id} />
              ))}
          </Stack>
        </QueryState>
      ) : (
        <QueryState
          loading={driverActive.isLoading}
          error={driverActive.error}
          empty={activeDriverTrips.length === 0}
          emptyText={EMPTY_STATES.tripActive.description}
          emptyAction={
            <Button
              size="m"
              onClick={() => {
                haptic.light();
                navigate("/profile/history");
              }}
            >
              История поездок
            </Button>
          }
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void driverActive.refetch();
          }}
        >
          <Stack>
            {activeDriverTrips.map((trip) => (
              <TripCard
                key={trip.id}
                variant={{
                  kind: "driving",
                  trip,
                  driverRating: profile.data?.rating ?? null,
                  onCancel: (id) =>
                    cancelTrip.mutate(id, {
                      onSuccess: () => {
                        haptic.warning();
                        toast.show({ text: "Поездка отменена" });
                      },
                    }),
                  cancelPending:
                    cancelTrip.isPending && cancelTrip.variables === trip.id,
                }}
              />
            ))}
            <FetchMore
              hasNextPage={driverActive.hasNextPage}
              isFetchingNextPage={driverActive.isFetchingNextPage}
              fetchNextPage={() => void driverActive.fetchNextPage()}
              sentinelRef={activeSentinelRef}
              placeholder={<TripCardSkeleton />}
              placeholderLabel="Загрузка ещё поездок"
            />
            <Button size="l" onClick={() => navigate("/trips")}>
              Найти поездку
            </Button>
            <Button size="l" onClick={() => navigate("/trips/my/new")}>
              + Создать поездку
            </Button>
          </Stack>
        </QueryState>
      )}
    </Page>
  );
}
