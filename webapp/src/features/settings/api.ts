import { apiGet } from "@/lib/api-client";
import {
  adminSettingsDtoSchema,
  adminTelegramMetricsDtoSchema,
  type AdminSettingsDto,
  type AdminTelegramMetricsDto,
} from "@edem/contracts";

/**
 * Read-only снимок rate-limit'ов и флагов из env
 * (GET /api/v1/admin/settings, backend/src/admin/index.ts).
 */
export function fetchSettings(): Promise<AdminSettingsDto> {
  return apiGet("/settings", adminSettingsDtoSchema);
}

/**
 * Счётчики Telegram-outbox (GET /api/v1/admin/telegram/metrics).
 * Схема `.strict()` — неожиданные поля в ответе ломают запрос fail-closed,
 * как и любой другой admin-контракт.
 */
export function fetchTelegramMetrics(): Promise<AdminTelegramMetricsDto> {
  return apiGet("/telegram/metrics", adminTelegramMetricsDtoSchema);
}
