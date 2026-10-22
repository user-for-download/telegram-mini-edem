import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminReportsQuery, UpdateReportStatusDto } from "@edem/contracts";

import { fetchReportDetail, fetchReports, updateReportStatus } from "./api";

const reportsKey = (params: AdminReportsQuery) =>
  ["admin", "reports", params] as const;

export const reportDetailKey = (id: string | null) =>
  ["admin", "reports", "detail", id] as const;

export function useReportsQuery(params: AdminReportsQuery) {
  return useQuery({
    queryKey: reportsKey(params),
    queryFn: () => fetchReports(params),
  });
}

/**
 * Детальная карточка жалобы. Запрос выключен, пока диалог закрыт
 * (id === null), поэтому скрытый диалог не ходит в сеть.
 */
export function useReportDetailQuery(id: string | null) {
  return useQuery({
    queryKey: reportDetailKey(id),
    queryFn: () => {
      if (id === null) throw new Error("Report id is required");
      return fetchReportDetail(id);
    },
    enabled: id !== null,
  });
}

/**
 * Смена статуса жалобы. Инвалидируем и список (фильтр по статусу мог
 * сузиться), и детальную карточку, если она открыта. Колбэки onSuccess/onError
 * остаются за страницей — она показывает объявляемый фидбек модерации.
 */
export function useUpdateReportStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReportStatusDto }) =>
      updateReportStatus(id, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      void queryClient.invalidateQueries({
        queryKey: reportDetailKey(updated.id),
      });
    },
  });
}
