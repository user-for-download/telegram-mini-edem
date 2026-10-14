import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createFeedbackReply,
  fetchFeedback,
  fetchFeedbackById,
  updateFeedbackReply,
} from "./api";

export interface FeedbackQueryParams {
  page: number;
  pageSize: number;
}

const feedbackKey = (p: FeedbackQueryParams) => ["admin", "feedback", p] as const;
const feedbackDetailKey = (id: string) =>
  ["admin", "feedback", "detail", id] as const;

export function useFeedbackQuery(params: FeedbackQueryParams) {
  return useQuery({
    queryKey: feedbackKey(params),
    queryFn: () => fetchFeedback(params),
  });
}

export function useFeedbackDetailQuery(id: string | null) {
  return useQuery({
    queryKey: id ? feedbackDetailKey(id) : ["admin", "feedback", "detail", "none"],
    queryFn: () => {
      if (id === null) throw new Error("Feedback id is required");
      return fetchFeedbackById(id);
    },
    enabled: Boolean(id),
  });
}

/**
 * POST /admin/feedback/:id/reply. После успеха — инвалидируем список И
 * точечно обновляем детальный кэш (если он уже был открыт).
 */
export function useCreateFeedbackReplyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      createFeedbackReply(id, reply),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
      qc.setQueryData(feedbackDetailKey(updated.id), updated);
    },
  });
}

/**
 * PUT /admin/feedback/:id/reply. После успеха — точечно обновляем
 * детальный кэш и инвалидируем список.
 */
export function useUpdateFeedbackReplyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      updateFeedbackReply(id, reply),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
      qc.setQueryData(feedbackDetailKey(updated.id), updated);
    },
  });
}
