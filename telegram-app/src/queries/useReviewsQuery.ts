import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { reviewsApi } from "@/api/reviews.api";
import { USER_KEYS } from "./useUsersQuery";
import type { CreateReviewDto } from "@edem/contracts";

export const REVIEW_KEYS = {
  all: ["reviews"] as const,
  user: (userId: string) =>
    [...REVIEW_KEYS.all, "user", userId] as const,
  userPaginated: (userId: string, limit: number) =>
    [...REVIEW_KEYS.user(userId), "paginated", limit] as const,
  my: () => [...REVIEW_KEYS.all, "my"] as const,
  availableTrips: () =>
    [...REVIEW_KEYS.all, "available-trips"] as const,
};

export function useMyReviewsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REVIEW_KEYS.my(),
    queryFn: ({ signal }) => reviewsApi.getMyReviews(signal),
    enabled: options?.enabled ?? true,
  });
}

export function useUserReviewsQuery(
  userId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: REVIEW_KEYS.user(userId),
    queryFn: async ({ signal }) =>
      (await reviewsApi.getUserReviews(userId, undefined, 20, signal)).items,
    enabled: Boolean(userId) && (options?.enabled ?? true),
  });
}

export function useUserReviewsInfiniteQuery(userId: string, limit = 20) {
  return useInfiniteQuery({
    queryKey: REVIEW_KEYS.userPaginated(userId, limit),
    queryFn: ({ pageParam, signal }) =>
      reviewsApi.getUserReviews(userId, pageParam, limit, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

export function useAvailableReviewTripsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REVIEW_KEYS.availableTrips(),
    queryFn: ({ signal }) => reviewsApi.getAvailableTrips(signal),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateReviewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReviewDto) => reviewsApi.createReview(data),
    onSuccess: (_, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: REVIEW_KEYS.all }),
        queryClient.invalidateQueries({
          queryKey: USER_KEYS.detail(variables.targetUserId),
        }),
        queryClient.invalidateQueries({ queryKey: ["trips"] }),
        queryClient.invalidateQueries({ queryKey: ["bookings"] }),
      ]),
  });
}
