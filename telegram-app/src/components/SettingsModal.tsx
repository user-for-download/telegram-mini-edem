import { useEffect, useState } from "react";
import {
  Button,
  Caption,
  IconContainer,
  Modal,
  Text,
} from "@telegram-apps/telegram-ui";
import { Bell, BellRing } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import {
  useProfileNotificationSettingsMutation,
  useProfileQuery,
} from "@/queries/profile";

/**
 * Настройки уведомлений — route-backed шторка поверх «Профиля»; роут
 * /settings остаётся источником правды ради диплинков START_PARAM_ROUTES и
 * точки входа из ProfilePage — тот же navigate("/settings")).
 *
 * a11y: telegram-ui Modal даёт role=dialog, Esc-закрытие (onOpenChange) и
 * focus-trap; интерактив в теле — таргеты ≥44px (min-h), статусы — через
 * aria-live/role=status, ошибки — role=alert.
 */
export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Настройки</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <SettingsBody />
      </div>
    </Modal>
  );
}

/**
 * Роут /settings: фон — «Профиль» (точка входа), поверх — шторка настроек.
 * Закрытие — назад по истории (native Back/Shell backButton), иначе
 * fallback на /profile. PageHeader с back-кнопкой внутри тела нет —
 * закрытие через header модалки.
 */
export function SettingsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <ProfilePage />
      <SettingsModal open onClose={close} />
    </>
  );
}

/** Тело настроек (экспортировано для SSR-тестов: Modal — портал, в renderToString не попадает). */
export function SettingsBody() {
  const navigate = useNavigate();
  const profile = useProfileQuery();
  const save = useProfileNotificationSettingsMutation();

  // Ленивый инициализатор читает кэш синхронно — тело SSR-тестабельно
  // (useEffect в renderToString не выполняется); эффект ниже докручивает
  // значение на клиенте, когда профиль приехал позже первого рендера.
  const [enabled, setEnabled] = useState<boolean | null>(
    () => profile.data?.notificationsEnabled ?? null,
  );
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (profile.data && enabled === null) {
      setEnabled(profile.data.notificationsEnabled ?? true);
    }
  }, [profile.data, enabled]);

  useEffect(() => {
    if (!showSaved) return;
    const timer = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [showSaved]);

  const toggle = (next: boolean) => {
    if (save.isPending || enabled === null) return;
    const previous = enabled;
    setEnabled(next);
    save.mutate(next, {
      onSuccess: () => setShowSaved(true),
      onError: () => setEnabled(previous),
    });
  };

  return (
    <>
      <MutationError error={save.error} />
      <QueryState
        loading={profile.isLoading}
        error={profile.error}
        empty={!profile.data || enabled === null}
        emptyText="Не удалось загрузить настройки."
        onRetry={() => void profile.refetch()}
      >
        <div className="flex flex-col gap-3.5 pt-1 pb-4">
          <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
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
              className="min-h-11"
              loading={save.isPending}
              disabled={save.isPending || enabled === null}
              onClick={() => toggle(!enabled)}
            >
              {enabled ? "Выключить некритичные" : "Включить уведомления"}
            </Button>
            {showSaved && (
              <Text
                Component="p"
                className="text-(--tgui--link_color)"
                role="status"
              >
                Настройки сохранены
              </Text>
            )}
            <Caption Component="p" className="leading-relaxed">
              Настройка синхронизируется с аккаунтом. Отдельные настройки звука
              и типов уведомлений пока не поддерживаются.
            </Caption>
            <Button
              mode="bezeled"
              size="m"
              stretched
              className="min-h-11"
              onClick={() => navigate("/notifications")}
            >
              Открыть уведомления
            </Button>
          </div>
        </div>
      </QueryState>
    </>
  );
}
