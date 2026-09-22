import { useEffect, useState } from "react";
import {
  Button,
  Caption,
  IconContainer,
  Section,
  Text,
} from "@telegram-apps/telegram-ui";
import { ArrowLeft, Bell, BellRing } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import {
  useProfileQuery,
  useProfileNotificationSettingsMutation,
} from "@/queries/profile";
import styles from "./SettingsPage.module.css";

/**
 * Настройки уведомлений Telegram-приложения (порт VK NotificationsPanel,
 * без VK-специфики: push VK и сообщения сообщества отсутствуют —
 * уведомления доставляются внутри приложения; сообщения Telegram-бота —
 * отдельный будущий этап, не этот экран).
 *
 * Тумблер синхронизируется с backend (PATCH /users/me/notification-settings,
 * requireUser + sanitize + profileUpdateLimiter); при ошибке — откат
 * к предыдущему значению, зеркально VK-панели.
 */
export function SettingsPage() {
  const navigate = useNavigate();
  const profile = useProfileQuery();
  const save = useProfileNotificationSettingsMutation();

  // Ленивый инициализатор читает кэш синхронно — страница SSR-тестабельна
  // (useEffect в renderToString не выполняется); докрутка значения, когда
  // профиль приехал позже первого рендера — фазой рендера, а не эффектом
  // (setState в эффекте запрещён react-hooks/set-state-in-effect;
  // зеркально SettingsBody из components/Profile/SettingsModal).
  const [enabled, setEnabled] = useState<boolean | null>(
    () => profile.data?.notificationsEnabled ?? null,
  );
  const [showSaved, setShowSaved] = useState(false);

  if (profile.data && enabled === null) {
    setEnabled(profile.data.notificationsEnabled ?? true);
  }

  useEffect(() => {
    if (!showSaved) return;
    const timer = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [showSaved]);

  const toggle = (next: boolean) => {
    if (save.isPending) return;
    const previous = enabled;
    setEnabled(next);
    save.mutate(next, {
      onSuccess: () => setShowSaved(true),
      onError: () => setEnabled(previous),
    });
  };

  return (
    <>
      <PageHeader title="Настройки" />
      <MutationError error={save.error} />
      <QueryState
        loading={profile.isLoading}
        error={profile.error}
        empty={!profile.data || enabled === null}
        emptyText="Не удалось загрузить настройки."
        onRetry={() => void profile.refetch()}
      >
        <div className={styles.wrap}>
          {/* Панель тумблера: поверхность — Section без заголовка. */}
          <Section>
            <div className={styles.panel}>
              <div className={styles.row}>
                <IconContainer>
                  {enabled ? <BellRing size={18} /> : <Bell size={18} />}
                </IconContainer>
                <Text Component="p" aria-live="polite">
                  {enabled
                    ? "Уведомления включены — подтверждение брони, отмена и завершение поездки."
                    : "Некритичные уведомления выключены — критичные статусы поездки и брони останутся в приложении."}
                </Text>
              </div>
              <Button
                mode="bezeled"
                stretched
                size="l"
                loading={save.isPending}
                disabled={save.isPending || enabled === null}
                onClick={() => toggle(!enabled)}
              >
                {enabled ? "Выключить некритичные" : "Включить уведомления"}
              </Button>
              {showSaved && (
                <Text Component="p" className={styles.link} role="status">
                  Настройки сохранены
                </Text>
              )}
              <Caption Component="p" className={styles.prose}>
                Настройка синхронизируется с аккаунтом. Отдельные настройки
                звука и типов уведомлений пока не поддерживаются.
              </Caption>
              <div className={styles.actions}>
                <Button
                  mode="bezeled"
                  size="s"
                  stretched
                  onClick={() => navigate("/notifications")}
                >
                  Открыть уведомления
                </Button>
                <Button
                  mode="bezeled"
                  size="s"
                  stretched
                  before={<ArrowLeft size={15} />}
                  onClick={() => navigate("/profile")}
                >
                  Назад в профиль
                </Button>
              </div>
            </div>
          </Section>
        </div>
      </QueryState>
    </>
  );
}
