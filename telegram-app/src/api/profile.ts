import { z } from "zod";
import { userSchema, type User } from "@edem/contracts";
import { apiClient } from "./client";

const successSchema = z.object({ success: z.boolean() }).strict();

export interface ProfileUpdateDto {
  name?: string;
  about?: string | null;
  phone?: string | null;
}

/**
 * Профильный API Telegram-приложения (порт mini-app users.api).
 *
 * Все ответы валидируются shared-контрактами (@edem/contracts) через
 * apiClient.request(..., schema) — fail-closed: невалидный ответ сервера
 * превращается в ApiError INVALID_RESPONSE, а не в битые данные UI.
 * Мутации идут через существующие backend-контроли: requireUser,
 * sanitize (getSanitizedBody), profileUpdateLimiter / mutationLimiter.
 */
export const profileApi = {
  getCurrentUser: (signal?: AbortSignal): Promise<User> =>
    apiClient.request("/users/me", { signal }, userSchema),

  updateProfile: (data: ProfileUpdateDto): Promise<User> =>
    apiClient.request(
      "/users/me",
      { method: "PATCH", body: JSON.stringify(data) },
      userSchema,
    ),

  updateNotificationSettings: (enabled: boolean): Promise<User> =>
    apiClient.request(
      "/users/me/notification-settings",
      {
        method: "PATCH",
        body: JSON.stringify({ notificationsEnabled: enabled }),
      },
      userSchema,
    ),

  deleteAccount: (): Promise<{ success: boolean }> =>
    apiClient.request("/users/me", { method: "DELETE" }, successSchema),

  /**
   * Логаут: backend отзывает refresh-токен (POST /auth/logout — всегда 200,
   * идемпотентен), локальная очистка сессии — в useLogoutMutation.
   * Без refresh-токена шлём пустое тело: backend всё равно отвечает success.
   */
  logout: (refreshToken?: string): Promise<{ success: boolean }> =>
    apiClient.request(
      "/auth/logout",
      {
        method: "POST",
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      },
      successSchema,
    ),
};
