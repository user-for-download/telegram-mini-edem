import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileApi, type ProfileUpdateDto } from "@/api/profile";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Ключи ресурса «пользователь». Префикс один и общий: и собственный
 * профиль (/users/me), и публичный (/users/:id) — это один ресурс, и
 * инвалидация по префиксу должна бить оба. КлючиDetail переехали сюда из
 * удалённого queries/useUsersQuery.ts: их единственный потребитель —
 * инвалидация профиля жертвы после отзыва (useReviewsQuery).
 */
export const USER_KEYS = {
  all: ["users"] as const,
  current: () => [...USER_KEYS.all, "me"] as const,
  details: () => [...USER_KEYS.all, "detail"] as const,
  detail: (id: string) => [...USER_KEYS.details(), id] as const,
};

/**
 * Ключи кэша профиля. Намеренно совпадают с USER_KEYS.current():
 * profile-хуки и vehicle-хуки читают/пишут одну и ту же запись —
 * рассинхрона кэша между модулями нет, инвалидация из любого места
 * видна всем.
 */
export const PROFILE_KEYS = {
  all: USER_KEYS.all,
  current: USER_KEYS.current,
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

// Решение по логауту: кнопки «Выйти» в приложении нет осознанно
// (ProfilePage: «Кнопки "Выйти" нет — только удаление, как Delete My
// Account официалки»), поэтому useLogoutMutation и profileApi.logout
// были недостижимым кодом. Удалены вместе. Если «Выйти» понадобится,
// точка входа — здесь: POST /auth/logout на backend жив.
//
