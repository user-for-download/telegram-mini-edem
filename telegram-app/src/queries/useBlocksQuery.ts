import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { blocksApi } from "@/api/blocks.api";
import { BLOCK_KEYS, RIDE_REQUEST_KEYS, TRIP_KEYS } from "./keys";

async function refreshVisibility(
  queryClient: QueryClient,
  userId: string,
  blockedByMe: boolean,
): Promise<void> {
  queryClient.setQueryData(BLOCK_KEYS.status(userId), { blockedByMe });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: BLOCK_KEYS.lists() }),
    // resetQueries убирает уже показанные карточки до refetch, а не оставляет
    // приватно устаревший список на экране как простая invalidation.
    queryClient.resetQueries({ queryKey: TRIP_KEYS.lists() }),
    queryClient.resetQueries({ queryKey: TRIP_KEYS.details() }),
    queryClient.invalidateQueries({ queryKey: RIDE_REQUEST_KEYS.all }),
  ]);
}

export function useInfiniteBlockedUsersQuery() {
  return useInfiniteQuery({
    queryKey: [...BLOCK_KEYS.lists(), "infinite"] as const,
    queryFn: ({ pageParam, signal }) => blocksApi.list(pageParam, 20, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.page + 1
        : undefined,
    staleTime: 30_000,
  });
}

export function useBlockStatusQuery(
  userId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: BLOCK_KEYS.status(userId),
    queryFn: ({ signal }) => blocksApi.status(userId, signal),
    enabled: (options?.enabled ?? true) && Boolean(userId),
    staleTime: 30_000,
  });
}

export function useBlockUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => blocksApi.block(userId),
    onSuccess: (_item, userId) =>
      refreshVisibility(queryClient, userId, true),
  });
}

export function useUnblockUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => blocksApi.unblock(userId),
    onSuccess: (_result, userId) =>
      refreshVisibility(queryClient, userId, false),
  });
}
