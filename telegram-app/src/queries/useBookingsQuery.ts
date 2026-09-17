import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { bookingsApi } from "@/api/bookings.api";
import { TRIP_KEYS } from "./useTripsQuery";
import type { CreateBookingDto, DriverBookingAction } from "@edem/contracts";

export const BOOKING_KEYS = {
  all: ["bookings"] as const,
  my: () => [...BOOKING_KEYS.all, "my"] as const,
  history: () => [...BOOKING_KEYS.all, "history"] as const,
  trip: (tripId: string) =>
    [...BOOKING_KEYS.all, "trip", tripId] as const,
  driver: () => [...BOOKING_KEYS.all, "driver"] as const,
};

export function useMyBookingsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: BOOKING_KEYS.my(),
    queryFn: ({ signal }) => bookingsApi.getUserBookings(signal),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function usePassengerHistoryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: BOOKING_KEYS.history(),
    queryFn: ({ signal }) => bookingsApi.getHistory(signal),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/**
 * Pending-заявки на все активные поездки водителя — сводка для главной.
 */
export function useDriverRequestsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: BOOKING_KEYS.driver(),
    queryFn: ({ signal }) => bookingsApi.getDriverRequests(signal),
    enabled: options?.enabled ?? true,
  });
}

export function useTripBookingsQuery(
  tripId: string,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: BOOKING_KEYS.trip(tripId),
    queryFn: ({ pageParam, signal }) =>
      bookingsApi.getTripBookings(tripId, pageParam, 50, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    enabled: Boolean(tripId) && (options?.enabled ?? true),
  });
}

function useInvalidateBookingsAndTrips() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: TRIP_KEYS.all }),
    ]);
}

export function useCreateBookingMutation() {
  const invalidate = useInvalidateBookingsAndTrips();
  return useMutation({
    mutationFn: (data: CreateBookingDto) => bookingsApi.createBooking(data),
    onSuccess: invalidate,
  });
}

export function useUpdateBookingStatusMutation() {
  const invalidate = useInvalidateBookingsAndTrips();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: DriverBookingAction }) =>
      bookingsApi.updateBookingStatus(id, { status }),
    onSuccess: invalidate,
  });
}

export function useCancelBookingMutation() {
  const invalidate = useInvalidateBookingsAndTrips();
  return useMutation({
    mutationFn: (id: string) => bookingsApi.cancelBooking(id),
    onSuccess: invalidate,
  });
}
