import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminTripsQuery } from "@edem/contracts";
import { toast } from "sonner";

import { cancelTrip, fetchTripDetail, fetchTrips } from "./api";

export type TripsQueryParams = AdminTripsQuery;

const tripsKey = (p: AdminTripsQuery) => ["admin", "trips", p] as const;
export const tripDetailKey = (id: string | null) =>
  ["admin", "trips", "detail", id] as const;

export function useTripsQuery(params: AdminTripsQuery) {
  return useQuery({
    queryKey: tripsKey(params),
    queryFn: () => fetchTrips(params),
  });
}

/**
 * Детальная карточка поездки. Запрос выключен, пока диалог закрыт
 * (id === null), поэтому скрытый диалог не ходит в сеть.
 */
export function useTripDetailQuery(id: string | null) {
  return useQuery({
    queryKey: tripDetailKey(id),
    queryFn: () => {
      if (id === null) throw new Error("Trip id is required");
      return fetchTripDetail(id);
    },
    enabled: id !== null,
  });
}

export function useCancelTripMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => cancelTrip(id),
    onSuccess: (_trip, id) => {
      // Статус поездки влияет и на метрики дашборда — инвалидируем оба кэша.
      // Ключ detail вложен в «admin/trips», но инвалидируем его явно, чтобы
      // открытый диалог гарантированно перезапросился после отмены.
      void queryClient.invalidateQueries({ queryKey: ["admin", "trips"] });
      void queryClient.invalidateQueries({ queryKey: tripDetailKey(id) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast.success("Поездка отменена");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Не удалось отменить поездку"
      );
    },
  });
}
