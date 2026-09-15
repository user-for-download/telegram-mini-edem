import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileApi, type ProfileUpdateDto } from "@/api/profile";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Ключи кэша профиля. Намеренно совпадают с USER_KEYS (["users", "me"]):
 * profile-хуки и users-хуки читают/пишут одну и ту же запись — рассинхрона
 * кэша между двумя модулями нет, инвалидация из любого места видна всем.
 */
export const PROFILE_KEYS = {
  all: ["users"] as const,
  current: () => [...PROFILE_KEYS.all, "me"] as const,
};

export function useProfileQuery(options?: {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
}) {
  return useQuery({
    queryKey: PROFILE_KEYS.current(),
    queryFn: ({ signal }) => profileApi.getCurrentUser(signal),
    enabled: options?.enabled ?? true,
    refetchOnMount: options?.refetchOnMount,
  });
}

export function useProfileUpdateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProfileUpdateDto) => profileApi.updateProfile(data),
    onSuccess: (user) => {
      queryClient.setQueryData(PROFILE_KEYS.current(), user);
      useAuthStore.setState({ user });
    },
  });
}

export function useProfileNotificationSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      profileApi.updateNotificationSettings(enabled),
    onSuccess: (user) => {
      queryClient.setQueryData(PROFILE_KEYS.current(), user);
      useAuthStore.setState({ user });
    },
  });
}

/**
 * Удаление аккаунта: после успеха кэш профиля сносится, стор переводится
 * в терминальное состояние "deleted" (markAccountDeleted) — AuthGate
 * показывает экран «Профиль удалён» вместо ретрая авторизации
 * (удалённому /auth/telegram отвечает 403, ретрай зациклился бы).
 */
export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => profileApi.deleteAccount(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: PROFILE_KEYS.all });
      useAuthStore.getState().markAccountDeleted();
    },
  });
}

/**
 * Выход: backend отзывает refresh-токен, локально сессия очищается
 * (clearSession гасит in-flight refresh, чтобы он не воскресил сессию).
 */
export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const refreshToken = useAuthStore.getState().session?.refreshToken;
      await profileApi.logout(refreshToken ?? undefined);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: PROFILE_KEYS.all });
      void useAuthStore.getState().clearSession("logout");
    },
  });
}
