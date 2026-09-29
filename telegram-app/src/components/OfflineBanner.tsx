import { Banner } from "@telegram-apps/telegram-ui";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Предупреждение о stale-данных и подтверждение восстановления
 * соединения (role=status, aria-live). Нативный Banner type="inline".
 *
 * Один глобальный экземпляр — в AppConfig (покрывает все страницы).
 * Локальные копии — ТОЛЬКО внутри Sheet-шторок (портал перекрывает
 * глобальный баннер). На страницах не дублировать.
 */
export function OfflineBanner() {
  const { isOnline, wasOffline } = useOnlineStatus();
  if (isOnline && !wasOffline) return null;
  return (
    <Banner
      type="inline"
      before={<WifiOff size={24} />}
      description={
        isOnline && wasOffline
          ? "Соединение восстановлено"
          : "Нет подключения. Показанные данные могут быть устаревшими"
      }
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
    />
  );
}
