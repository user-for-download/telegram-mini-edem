import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileApi, type ProfileUpdateDto } from "@/api/profile";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError } from "@/api/client";
import { useCommittedMutation } from "./useCommittedMutation";

/**
 * Ключи ресурса «пользователь». Префикс один и общий: и собственный
 * профиль (/users/me), и публичный (/users/:id) — это один ресурс, и
 * инвалидация по префиксу должна бить оба. КлючиDetail переехали сюда из
 * удалённого queries/useUsersQuery.ts: их единственный потребитель —
 * инвалидация профиля жертвы после отзыва (useReviewsQuery).
 */
export const USER_KEYS = {
  all: ["users"] as const,
  current: (ownerId?: string | null) => ownerId
    ? [...USER_KEYS.all, "me", ownerId] as const
    : [...USER_KEYS.all, "me"] as const,
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
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery({
    queryKey: PROFILE_KEYS.current(ownerId),
    queryFn: async ({ signal }) => {
      const user = await profileApi.getCurrentUser(signal);
      if (user.id !== ownerId) throw new ApiError("Invalid server response", "INVALID_RESPONSE", 502);
      return user;
    },
    enabled: Boolean(ownerId) && (options?.enabled ?? true),
    refetchOnMount: options?.refetchOnMount,
  });
}

/**
 * Публичный профиль другого пользователя (шторка профиля: тап по
 * водителю, пассажиру или автору отзыва).
 *
 * Ключ — общий с USER_KEYS.detail: этот ключ уже был заведён под
 * инвалидацию жертвы после отзыва, и он же теперь читается здесь.
 * Поэтому новый отзыв обновит открытый профиль без ручной связки.
 *
 * enabled по Boolean(id): пустой id — это не запрос, а шторка, которая
 * ещё не открыта (или закрылась на другом человеке).
 */
export function useUserQuery(
  id: string,
  options?: { enabled?: boolean; staleTime?: number },
) {
  return useQuery({
    queryKey: USER_KEYS.detail(id),
    queryFn: ({ signal }) => profileApi.getUser(id, signal),
    enabled: (options?.enabled ?? true) && Boolean(id),
    staleTime: options?.staleTime,
  });
}

export function useProfileUpdateMutation() {
  const queryClient = useQueryClient();
  return useCommittedMutation({
    mutationFn: (data: ProfileUpdateDto) => profileApi.updateProfile(data),
    onSuccess: (user) => {
      if (useAuthStore.getState().user?.id !== user.id) return;
      queryClient.setQueryData(PROFILE_KEYS.current(user.id), user);
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
      if (useAuthStore.getState().user?.id !== user.id) return;
      queryClient.setQueryData(PROFILE_KEYS.current(user.id), user);
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
