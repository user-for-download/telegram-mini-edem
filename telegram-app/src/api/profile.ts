import { z } from "zod";
import {
  userSchema,
  type CompleteOnboardingBody,
  type User,
} from "@edem/contracts";
import { apiClient } from "./client";

const successSchema = z.object({ success: z.boolean() }).strict();

export interface ProfileUpdateDto {
  name?: string;
  about?: string | null;
  phone?: string | null;
}

/**
 * Профильный API Telegram-приложения — ЕДИНСТВЕННЫЙ источник ресурса
 * /users/me.
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

  /**
   * Публичный профиль другого пользователя (GET /users/:id).
   *
   * Тот же ресурс, что и /users/me, поэтому схема ответа та же —
   * userSchema. Сервер отдаёт сокращённый набор (serializePublicUser):
   * без телефона, настроек уведомлений и номера онбординга, все эти поля
   * в контракте опциональны, так что валидация проходит без изменений
   * контракта. Ответ fail-closed: невалидный ответ превращается в
   * ApiError INVALID_RESPONSE, а не в битые данные UI.
   *
   * id кодируется: он приходит из ответа сервера, и подстановка его в
   * путь как есть сломала бы маршрут на id со спецсимволами.
   */
  getUser: (id: string, signal?: AbortSignal): Promise<User> =>
    apiClient.request(
      `/users/${encodeURIComponent(id)}`,
      { signal },
      userSchema,
    ),

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

  /** Отметка прохождения онбординга (POST /users/me/onboarding). */
  completeOnboarding: (version: string): Promise<User> =>
    apiClient.request(
      "/users/me/onboarding",
      {
        method: "POST",
        body: JSON.stringify({ version } satisfies CompleteOnboardingBody),
      },
      userSchema,
    ),
};
