import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vehicleApi, type VehicleFormDto } from "@/api/vehicle";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileQuery } from "./profile";

/**
 * Ключи кэша автомобиля. Намеренно совпадают с PROFILE_KEYS/USER_KEYS
 * (["users", "me"]): vehicle-хуки и profile/users-хуки читают/пишут одну
 * и ту же запись пользователя — рассинхрона кэша между модулями нет,
 * инвалидация из любого места видна всем.
 */
export const VEHICLE_KEYS = {
  all: ["users"] as const,
  current: () => [...VEHICLE_KEYS.all, "me"] as const,
};

/**
 * Просмотр автомобиля: переиспользует profile-запрос под тем же ключом
 * (отдельного GET /users/me/car у backend нет) и селектит car.
 * Возвращает vehicle=null, когда авто не добавлено, — это штатный
 * empty-state («Чтобы публиковать поездки, добавьте автомобиль»),
 * а не ошибка.
 */
export function useVehicleQuery(options?: {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
}) {
  const profile = useProfileQuery(options);
  return { ...profile, vehicle: profile.data?.car ?? null };
}

/**
 * Создание/обновление авто (POST /users/me/car): после успеха кэш
 * ["users","me"] перезаписывается и стор синкается — зеркально
 * useProfileUpdateMutation (CarFormModal писал user в useAuthStore напрямую).
 */
export function useUpsertVehicleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VehicleFormDto) => vehicleApi.upsertVehicle(data),
    onSuccess: (user) => {
      queryClient.setQueryData(VEHICLE_KEYS.current(), user);
      useAuthStore.setState({ user });
    },
  });
}

/**
 * Обновление через PATCH-алиас backend (тот же upsertCar на сервере).
 */
export function useUpdateVehicleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VehicleFormDto) => vehicleApi.updateVehicle(data),
    onSuccess: (user) => {
      queryClient.setQueryData(VEHICLE_KEYS.current(), user);
      useAuthStore.setState({ user });
    },
  });
}

/**
 * Удаление автомобиля (DELETE /users/me/car): после успеха кэш
 * ["users","me"] перезаписывается пользователем без car и стор синкается —
 * зеркально upsert-мутациям выше. 409 при активных поездках и 404 без авто
 * пробрасываются вызывающему (текст — vehicleRemoveErrorMessage на странице).
 */
export function useRemoveVehicleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vehicleApi.removeVehicle(),
    onSuccess: (user) => {
      queryClient.setQueryData(VEHICLE_KEYS.current(), user);
      useAuthStore.setState({ user });
    },
  });
}
