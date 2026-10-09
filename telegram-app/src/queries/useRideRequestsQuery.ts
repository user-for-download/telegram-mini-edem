import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  rideRequestsApi,
  type MutableRideRequestStatus,
} from "@/api/rideRequests.api";
import type {
  CreateRideRequestDto,
  UpdateRideRequestDto,
} from "@edem/contracts";

export const RIDE_REQUEST_KEYS = {
  all: ["ride-requests"] as const,
};

/**
 * Лента заявок попутчиков для главной: чужие активные, ближайшее окно сверху.
 *
 * Отдельный ключ, а не `RIDE_REQUEST_KEYS.all`: лента и список моих заявок —
 * разные данные с разным временем жизни. Пересчитывать список после публикации
 * (как это делает `useRideRequestMutation`) здесь незачем — заявок чужих мы не
 * создаём и не отменяем.
 */
export function useRideRequestFeedQuery(enabled = true) {
  return useQuery({
    queryKey: [...RIDE_REQUEST_KEYS.all, "feed"] as const,
    queryFn: ({ signal }) => rideRequestsApi.feed(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useRideRequestsQuery(enabled = true) {
  return useInfiniteQuery({
    // Ключ под RIDE_REQUEST_KEYS.all: инвалидация мутаций заявок по
    // префиксу `all` обновляет и этот список без отдельной правки.
    queryKey: [...RIDE_REQUEST_KEYS.all, "mine", "infinite"] as const,
    queryFn: ({ pageParam, signal }) =>
      rideRequestsApi.list(pageParam, 20, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    enabled,
    staleTime: 30_000,
  });
}

function useRideRequestMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: RIDE_REQUEST_KEYS.all }),
  });
}

export function useCreateRideRequestMutation() {
  return useRideRequestMutation((data: CreateRideRequestDto) =>
    rideRequestsApi.create(data),
  );
}

export function useUpdateRideRequestMutation() {
  return useRideRequestMutation(
    ({ id, data }: { id: string; data: UpdateRideRequestDto }) =>
      rideRequestsApi.update(id, data),
  );
}

export function useRideRequestStatusMutation() {
  return useRideRequestMutation(
    ({ id, status }: { id: string; status: MutableRideRequestStatus }) =>
      rideRequestsApi.setStatus(id, status),
  );
}

export function useCancelRideRequestMutation() {
  return useRideRequestMutation((id: string) => rideRequestsApi.cancel(id));
}
