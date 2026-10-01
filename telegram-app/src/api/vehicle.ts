import { userSchema, type User } from "@edem/contracts";
import { apiClient } from "./client";

export interface VehicleFormDto {
  model: string;
  color: string;
  /**
   * Номер-примета опционален: отсутствие ключа = бэкенд хранит null
   * (JSON.stringify дропает undefined). Повторный upsert без plate
   * стирает ранее сохранённый номер — это же remove-путь идентификатора.
   */
  plate?: string;
}

/**
 * Автомобильный API Telegram-приложения: подресурс /users/me/car.
 * Просмотр авто намеренно НЕ здесь — он идёт через profileApi.getCurrentUser
 * (у backend нет GET /users/me/car), см. queries/vehicle.ts.
 *
 * Все ответы валидируются shared-контрактами (@edem/contracts,
 * userSchema/carSchema) через apiClient.request(..., schema) — fail-closed:
 * невалидный ответ превращается в ApiError INVALID_RESPONSE.
 *
 * Backend-контроли (backend/src/users/index.ts):
 * - auth: requireUser (JWT; без токена — 401);
 * - валидация: carFormSchema { model 1..50, color 1..30, plate max 15 optional },
 *   пустой/пробельный plate нормализуется в null — иначе 400 Invalid payload;
 * - rate limit: profileUpdateLimiter на POST|PATCH /me/car — иначе 429;
 * - sanitize: getSanitizedBody.
 *
 * Privacy (backend/src/serializers/index.ts):
 * - plate присутствует ТОЛЬКО в own-ответе /users/me (и опускается при null);
 * - публичный профиль и участники поездок plate не получают;
 * - удалённые пользователи сериализуются tombstone без car вообще.
 *
 * Удаление автомобиля — DELETE /users/me/car: только свой userId
 * (requireUser), при активных поездках водителя backend отвечает 409
 * ACCOUNT_HAS_ACTIVE_OBLIGATIONS (создание поездок требует car),
 * без авто — 404. Возвращает обновлённого пользователя для синка кэша.
 */
export const vehicleApi = {
  /**
   * Создание/обновление (порт CarFormModal → POST /users/me/car).
   * Возвращает обновлённого пользователя — кэш и стор синкаются в queries/vehicle.
   */
  upsertVehicle: (data: VehicleFormDto): Promise<User> =>
    apiClient.request(
      "/users/me/car",
      { method: "POST", body: JSON.stringify(data) },
      userSchema,
    ),

  /**
   * Алиас обновления (backend: PATCH /users/me/car → тот же upsertCar).
   */
  updateVehicle: (data: VehicleFormDto): Promise<User> =>
    apiClient.request(
      "/users/me/car",
      { method: "PATCH", body: JSON.stringify(data) },
      userSchema,
    ),

  /**
   * Удаление автомобиля (backend: DELETE /users/me/car).
   * Возвращает обновлённого пользователя без car — кэш и стор синкаются
   * в queries/vehicle (useRemoveVehicleMutation).
   */
  removeVehicle: (): Promise<User> =>
    apiClient.request("/users/me/car", { method: "DELETE" }, userSchema),
};
