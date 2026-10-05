import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  tripsApi,
  type SearchTripsFilters,
  type UpdateTripDto,
} from "@/api/trips.api";
import type { CreateTripDto } from "@edem/contracts";
import { REVIEW_KEYS } from "./useReviewsQuery";

export const TRIP_KEYS = {
  all: ["trips"] as const,
  lists: () => [...TRIP_KEYS.all, "list"] as const,
  list: (filters?: SearchTripsFilters) =>
    [...TRIP_KEYS.lists(), filters] as const,
  my: () => [...TRIP_KEYS.all, "my"] as const,
  details: () => [...TRIP_KEYS.all, "detail"] as const,
  detail: (id: string) => [...TRIP_KEYS.details(), id] as const,
};

export function useInfiniteTripsQuery(filters?: SearchTripsFilters) {
  return useInfiniteQuery({
    queryKey: [...TRIP_KEYS.lists(), "infinite", filters] as const,
    queryFn: ({ pageParam, signal }) =>
      tripsApi.getTrips({ ...filters, page: pageParam, limit: 20 }, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.page + 1
        : undefined,
    staleTime: 60_000,
  });
}

export function useInfiniteMyTripsQuery(options?: {
  enabled?: boolean;
  status?: "active" | "archive";
}) {
  return useInfiniteQuery({
    queryKey: [...TRIP_KEYS.my(), "infinite", options?.status] as const,
    queryFn: ({ pageParam, signal }) =>
      tripsApi.getMyTrips(
        { page: pageParam, limit: 20, status: options?.status },
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.page + 1
        : undefined,
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useTripDetailQuery(id: string) {
  return useQuery({
    queryKey: TRIP_KEYS.detail(id),
    queryFn: ({ signal }) => tripsApi.getTripById(id, signal),
    enabled: Boolean(id),
  });
}

function useInvalidateTrips() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: TRIP_KEYS.all });
}

function useInvalidateTripsAndBookings() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: TRIP_KEYS.all }),
      // Сырой ключ вместо BOOKING_KEYS.all: useBookingsQuery импортирует
      // TRIP_KEYS отсюда, импорт в обратную сторону дал бы цикл.
      queryClient.invalidateQueries({ queryKey: ["bookings"] }),
    ]);
}

export function useCreateTripMutation() {
  const invalidateTrips = useInvalidateTrips();
  return useMutation({
    mutationFn: (data: CreateTripDto) => tripsApi.createTrip(data),
    onSuccess: invalidateTrips,
  });
}

export function useUpdateTripMutation() {
  const invalidateTrips = useInvalidateTrips();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripDto }) =>
      tripsApi.updateTrip(id, data),
    onSuccess: invalidateTrips,
  });
}

export function useCancelTripMutation() {
  const invalidateTripsAndBookings = useInvalidateTripsAndBookings();
  return useMutation({
    mutationFn: (id: string) => tripsApi.cancelTrip(id),
    onSuccess: invalidateTripsAndBookings,
  });
}

export function useCompleteTripMutation() {
  const invalidateTripsAndBookings = useInvalidateTripsAndBookings();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tripsApi.completeTrip(id),
    onSuccess: () =>
      Promise.all([
        invalidateTripsAndBookings(),
        // Завершение открывает поездку для отзыва: список доступных
        // поездок — отдельный ключ, он не лежит под trips/bookings.
        queryClient.invalidateQueries({ queryKey: REVIEW_KEYS.availableTrips() }),
      ]),
  });
}
