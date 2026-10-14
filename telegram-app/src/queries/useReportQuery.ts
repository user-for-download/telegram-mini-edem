import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/api/reports";
import type { CreateReportDto } from "@edem/contracts";

export const REPORT_KEYS = {
  all: ["reports"] as const,
  mine: () => [...REPORT_KEYS.all, "mine"] as const,
  targets: () => [...REPORT_KEYS.all, "targets"] as const,
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

/**
 * Объекты, на которые можно жаловаться — для выбора в форме.
 *
 * `staleTime` длиннее, чем у списка жалоб: набор меняется вместе с бронями,
 * а не мгновенно, и перезапрашивать его при каждом открытии окна незачем.
 */
export function useReportTargetsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REPORT_KEYS.targets(),
    queryFn: ({ signal }) => reportsApi.listTargets(signal),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
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
