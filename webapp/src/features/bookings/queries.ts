import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminBookingDto,
  AdminBookingStatusBody,
  AdminPaginatedBookings,
} from "@edem/contracts";
import { toast } from "sonner";

import {
  fetchBookingDetail,
  fetchBookings,
  updateBookingStatus,
  type FetchBookingsParams,
} from "./api";

const bookingsKey = (params: FetchBookingsParams) =>
  ["admin", "bookings", params] as const;

export const bookingDetailKey = (id: string | null) =>
  ["admin", "bookings", "detail", id] as const;

export function useBookingsQuery(params: FetchBookingsParams) {
  return useQuery({
    queryKey: bookingsKey(params),
    queryFn: () => fetchBookings(params),
  });
}

/**
 * Детальная карточка брони. Запрос выключен, пока диалог закрыт
 * (id === null), поэтому скрытый диалог не ходит в сеть.
 */
export function useBookingDetailQuery(id: string | null) {
  return useQuery({
    queryKey: bookingDetailKey(id),
    queryFn: () => {
      if (id === null) throw new Error("Booking id is required");
      return fetchBookingDetail(id);
    },
    enabled: id !== null,
  });
}

export interface BookingStatusMutationVars {
  id: string;
  body: AdminBookingStatusBody;
}

/**
 * Детальная карточка живёт под тем же префиксом `["admin","bookings"]`, но
 * имеет другую форму. Оптимистичный апдейт списка обязан её пропускать,
 * иначе `cached.items` окажется undefined.
 */
const isBookingListQuery = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[2] !== "detail";

export function useBookingStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: BookingStatusMutationVars) =>
      updateBookingStatus(id, body),
    // Optimistic update: render the new status instantly, roll back on failure.
    onMutate: ({ id, body }: BookingStatusMutationVars) => {
      const previous = queryClient.getQueriesData<AdminPaginatedBookings>({
        queryKey: ["admin", "bookings"],
        predicate: isBookingListQuery,
      });
      queryClient.setQueriesData<AdminPaginatedBookings>(
        { queryKey: ["admin", "bookings"], predicate: isBookingListQuery },
        (cached) => {
          if (!cached) return cached;
          const items: AdminBookingDto[] = cached.items.map((booking) =>
            booking.id === id ? { ...booking, status: body.status } : booking,
          );
          return { ...cached, items };
        },
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      // Roll back to the snapshot taken in onMutate so state stays consistent.
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message);
    },
    onSuccess: () => {
      toast.success("Статус брони обновлён");
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "bookings"] });
      // Открытая карточка брони должна перезапросить новый статус, даже
      // если список по каким-то причинам не совпал с её ключом.
      void queryClient.invalidateQueries({
        queryKey: bookingDetailKey(variables.id),
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
  });
}
