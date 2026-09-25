import { Notice } from "@/ui/Notice";
import { FetchMore } from "@/ui/FetchMore";
import { Button } from "@/ui/Button";
import { Page } from "@/ui/Page";

import { useNavigate } from "react-router-dom";
import { TripCard } from "@/components/Trip/TripCard";
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
  useMyBookingsQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useInfiniteMyTripsQuery,
} from "@/queries/useTripsQuery";
import { useProfileQuery } from "@/queries/profile";

/**
 * Активные поездки/брони — топ-level страница (корень Page из кита,
 * состояния через QueryState/EmptyState-обёртку). Вложенных Page нет:
 * TripPage — лишь совместимость query (?segment=history) без обёртки.
 */
export function TripActivePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const bookings = useMyBookingsQuery();
  const driverActive = useInfiniteMyTripsQuery({ status: "active" });
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
      <QueryState
        loading={bookings.isLoading || driverActive.isLoading}
        error={bookings.error ?? driverActive.error}
        empty={activeBookings.length === 0 && activeDriverTrips.length === 0}
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
          void driverActive.refetch();
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
        <Button
          size="l"
          onClick={() => navigate("/trips/my/new")}
        >
          + Создать поездку
        </Button>
        </Stack>
      </QueryState>
    </Page>
  );
}
