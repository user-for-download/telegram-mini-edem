import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewStatusValue } from "@edem/contracts";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-client";

import {
  approveReview,
  deleteReview,
  fetchReviewDetail,
  fetchReviews,
  rejectReview,
} from "./api";

export interface ReviewsQueryParams {
  status?: ReviewStatusValue;
  q?: string;
  authorId?: string;
  targetUserId?: string;
  page: number;
  pageSize: number;
}

const reviewsKey = (p: ReviewsQueryParams) => ["admin", "reviews", p] as const;
const reviewDetailKey = (id: string) =>
  ["admin", "reviews", "detail", id] as const;

export function useReviewsQuery(params: ReviewsQueryParams) {
  return useQuery({
    queryKey: reviewsKey(params),
    queryFn: () => fetchReviews(params),
  });
}

export function useReviewDetailQuery(id: string | null) {
  return useQuery({
    queryKey: id ? reviewDetailKey(id) : ["admin", "reviews", "detail", "none"],
    queryFn: () => {
      if (id === null) throw new Error("Review id is required");
      return fetchReviewDetail(id);
    },
    enabled: Boolean(id),
  });
}

/**
 * 409 CONFLICT на approve/reject означает, что отзыв уже обработан
 * (другой модератор или повторный клик): локальный кэш устарел.
 * Инвалидируем список и дашборд, чтобы админ видел актуальный статус,
 * а не подвисший stale UI.
 */
function invalidateReviewCaches(
  queryClient: ReturnType<typeof useQueryClient>
): void {
  void queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export function useDeleteReviewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteReview(id),
    onSuccess: () => {
      // Удаление отзыва влияет и на список, и на метрики дашборда — инвалидируем оба кэша.
      void queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast.success("Отзыв удалён");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Не удалось удалить отзыв"
      );
    },
  });
}

export function useApproveReviewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => approveReview(id),
    onSuccess: () => {
      // Публикация меняет состав списка и метрики дашборда — инвалидируем оба кэша.
      void queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast.success("Отзыв опубликован");
    },
    onError: (error) => {
      if (isConflict(error)) {
        invalidateReviewCaches(queryClient);
        toast.error("Отзыв уже обработан. Список обновлён.");
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось опубликовать отзыв"
      );
    },
  });
}

export function useRejectReviewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rejectReview(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast.success("Отзыв отклонён");
    },
    onError: (error) => {
      if (isConflict(error)) {
        invalidateReviewCaches(queryClient);
        toast.error("Отзыв уже обработан. Список обновлён.");
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Не удалось отклонить отзыв"
      );
    },
  });
}
