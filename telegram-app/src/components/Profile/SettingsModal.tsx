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
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import styles from "./ProfileModals.module.css";

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
  // Имя диалога для скринридера + видимый заголовок на base-платформе
  // (tgui Modal.Header рисует текст только на iOS).
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Настройки</Modal.Header>}
      aria-labelledby={titleId}
    >
      <div className={styles.sheetBody}>
        <SheetTitle titleId={titleId}>Настройки</SheetTitle>
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
  // (useEffect в renderToString не выполняется); докрутка значения, когда
  // профиль приехал позже первого рендера — фазой рендера, а не эффектом
  // (setState в эффекте запрещён react-hooks/set-state-in-effect).
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
        <div className={styles.stackSettings}>
          <div className={styles.card}>
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
                className={styles.link}
                role="status"
              >
                Настройки сохранены
              </Text>
            )}
            <Caption Component="p" className={styles.prose}>
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
