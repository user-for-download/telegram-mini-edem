import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AdminUsersQuery, BanUserBody } from "@edem/contracts";

import {
  banUser,
  fetchUserDetail,
  fetchUsers,
  resetOnboarding,
  stopUserTelegram,
  unbanUser,
} from "./api";

const usersKey = (p: AdminUsersQuery) => ["admin", "users", p] as const;
export const userDetailKey = (id: string | null) =>
  ["admin", "users", "detail", id] as const;

export function useUsersQuery(params: AdminUsersQuery) {
  return useQuery({
    queryKey: usersKey(params),
    queryFn: () => fetchUsers(params),
  });
}

/**
 * Детальная карточка пользователя. Запрос выключен, пока карточка закрыта
 * (id === null), поэтому скрытый диалог не ходит в сеть.
 */
export function useUserDetailQuery(id: string | null) {
  return useQuery({
    queryKey: userDetailKey(id),
    queryFn: () => {
      if (id === null) throw new Error("User id is required");
      return fetchUserDetail(id);
    },
    enabled: id !== null,
  });
}

export function useBanUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: BanUserBody }) =>
      banUser(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Пользователь заблокирован");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

export function useUnbanUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unbanUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Пользователь разблокирован");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

export function useResetOnboardingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resetOnboarding,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Онбординг сброшен");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Ручной стоп Telegram. После успеха инвалидируем список, открытую карточку
 * (telegramConnected/tgChatJoinedAt) и дашборд (telegramPending/failed).
 * В тосте показываем только счётчик отменённых доставок — без PII.
 */
export function useStopTelegramMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopUserTelegram,
    onSuccess: (result, id) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: userDetailKey(id) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      toast.success(
        `Telegram остановлен · отменено доставок: ${result.cancelledDeliveries}`,
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось остановить Telegram",
      );
    },
  });
}
