import { useQuery } from "@tanstack/react-query";

import { fetchSettings, fetchTelegramMetrics } from "./api";

const ADMIN_SETTINGS_KEY = ["admin", "settings"] as const;
const ADMIN_TELEGRAM_METRICS_KEY = ["admin", "telegram", "metrics"] as const;

export function useSettingsQuery() {
  return useQuery({
    queryKey: ADMIN_SETTINGS_KEY,
    queryFn: fetchSettings,
  });
}

/** Метрики outbox обновляются по запросу (retry в карточке) без polling'а. */
export function useTelegramMetricsQuery() {
  return useQuery({
    queryKey: ADMIN_TELEGRAM_METRICS_KEY,
    queryFn: fetchTelegramMetrics,
  });
}
