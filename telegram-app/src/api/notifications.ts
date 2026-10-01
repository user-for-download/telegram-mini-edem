import { z } from "zod";
import {
  notificationSchema,
  notificationsPageSchema,
  type Notification,
  type NotificationsPage,
} from "@edem/contracts";
import { apiClient } from "./client";

export type { Notification, NotificationsPage };

const readAllResultSchema = z.object({ success: z.boolean() }).strict();

/**
 * Inbox уведомлений Telegram-приложения (паритет mini-app notifications.api).
 *
 * Backend-маршруты (`/notifications/my` cursor-пагинация, `PATCH /:id/read`,
 * `PATCH /read-all`) защищены requireUser — работают с TG JWT без изменений:
 * ответы валидируются shared-контрактами (@edem/contracts) через
 * apiClient.request(..., schema) — fail-closed (INVALID_RESPONSE вместо битых
 * данных UI). Санитизация/rate-limit/cursor — серверная сторона, клиент
 * пробрасывает ApiError вызывающему (покрыто тестами).
 */
export const notificationsApi = {
  getMy: (
    cursor?: string,
    limit = 20,
    signal?: AbortSignal,
    filter?: { role?: "driver" | "passenger"; unreadOnly?: boolean },
  ): Promise<NotificationsPage> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      params.set("cursor", cursor);
    }
    // Серверный фильтр архивов (m3): role/unreadOnly резолвит бэкенд
    // по NOTIFICATION_ROLE_TYPES из @edem/contracts, клиент типы не знает.
    if (filter?.role) {
      params.set("role", filter.role);
    }
    if (filter?.unreadOnly) {
      params.set("unreadOnly", "1");
    }
    return apiClient.request<NotificationsPage>(
      `/notifications/my?${params.toString()}`,
      { signal },
      notificationsPageSchema,
    );
  },

  markRead: (id: string): Promise<Notification> => {
    return apiClient.request<Notification>(
      `/notifications/${encodeURIComponent(id)}/read`,
      { method: "PATCH" },
      notificationSchema,
    );
  },

  markAllRead: (): Promise<{ success: boolean }> => {
    return apiClient.request(
      "/notifications/read-all",
      { method: "PATCH" },
      readAllResultSchema,
    );
  },
};
