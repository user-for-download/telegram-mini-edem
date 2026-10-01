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
 * /users/me. Раньше тот же ресурс описывали ещё api/users.api.ts
 * (GET/PATCH /users/me, notification-settings, DELETE) и мёртвый
 * getCurrentVehicle в api/vehicle.ts; типы разъехались — users.api
 * не знал про phone, который есть в контракте. Дубли удалены.
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
   * Отметка прохождения онбординга (POST /users/me/onboarding). Раньше жил
   * в api/users.api.ts — второй модуль на тот же ресурс /users/me.
   */
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
