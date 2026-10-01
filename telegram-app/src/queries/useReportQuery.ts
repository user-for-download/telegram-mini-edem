import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/api/reports";
import type { CreateReportDto } from "@edem/contracts";

export const REPORT_KEYS = {
  all: ["reports"] as const,
  mine: () => [...REPORT_KEYS.all, "mine"] as const,
};

/**
 * Свои жалобы (порт useMyReportsQuery): backend отдаёт массив
 * (cap 50 последних, новые первыми). Используется и списком, и клиентским
 * хинтом лимита «1 жалоба навсегда» (hasExistingReport).
 */
export function useMyReportsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REPORT_KEYS.mine(),
    queryFn: ({ signal }) => reportsApi.listMine(signal),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useCreateReportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReportDto) => reportsApi.create(data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: REPORT_KEYS.mine() }),
  });
}
