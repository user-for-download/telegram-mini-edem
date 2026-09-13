import { memo, useMemo } from "react";
import { Button, Modal, Placeholder } from "@telegram-apps/telegram-ui";
import { BellRing, CheckCheck, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/ProfilePage";
import {
  isCriticalNotification,
  notificationRoute,
} from "@/pages/NotificationsPage";
import { ApiError } from "@/api/client";
import type { Notification } from "@edem/contracts";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInboxQuery,
} from "@/queries/useNotificationsQuery";

function formatDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NotificationCard = memo(function NotificationCard({
  notification,
  onMarkRead,
  marking,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  marking: boolean;
}) {
  // notificationRoute/isCriticalNotification — единственный источник правды
  // в NotificationsPage:51 (контракт parity, deep-link не меняется).
  const route = notificationRoute(notification.type);
  const critical = isCriticalNotification(notification.type);
  return (
    <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-[var(--tgui--text_color)]">
          {notification.title}
        </span>
        {critical ? (
          <span className="StatusPill shrink-0" data-tone="danger">
            Важное
          </span>
        ) : !notification.isRead ? (
          <span className="StatusPill shrink-0" data-tone="info">
            Новое
          </span>
        ) : null}
      </div>
      <p className="text-[13px] text-[var(--tgui--text_color)] leading-relaxed [overflow-wrap:anywhere]">
        {notification.body}
      </p>
      <span className="text-[11px] text-[var(--tgui--hint_color)]">
        {formatDate(notification.createdAt)}
      </span>
      <div className="flex items-center gap-3 pt-1 border-t border-[var(--tgui--outline)]">
        {route && (
          <a
            className="min-h-[44px] inline-flex items-center text-[13px] font-medium text-[var(--tgui--link_color)]"
            href={`#${route}`}
          >
            Открыть
          </a>
        )}
        {!notification.isRead && (
          <Button
            size="s"
            mode="bezeled"
            className="min-h-[44px]"
            loading={marking}
            disabled={marking}
            onClick={() => onMarkRead(notification.id)}
          >
            Отметить прочитанным
          </Button>
        )}
      </div>
    </div>
  );
});

/**
 * Тело inbox уведомлений без PageHeader (закрытие — через header модалки /
 * native Back; внутри модалки back-кнопки нет).
 * Экспортировано для SSR-тестов: Modal — портал, в renderToString не попадает.
 */
export function NotificationsBody() {
  const inbox = useNotificationsInboxQuery(20);
  const markRead = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();

  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  );
  const unreadCount = inbox.data?.pages[0]?.unreadCount ?? 0;

  // Бан mid-session: requireUser отвечает 403 — терминальный экран вместо
  // общей ошибки (паттерн ProfilePage/NotificationsPage).
  if (inbox.error instanceof ApiError && inbox.error.status === 403) {
    return (
      <Placeholder
        header="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован."
      />
    );
  }

  return (
    <section aria-label="Уведомления">
      <MutationError error={markRead.error ?? markAll.error} />
      <QueryState
        loading={inbox.isLoading}
        error={inbox.error}
        empty={false}
        emptyText=""
        onRetry={() => void inbox.refetch()}
      >
        <div className="flex flex-col gap-3.5 pt-1">
          <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <BellRing size={16} className="text-[var(--app-info)] shrink-0" />
              <p className="text-[14px] text-[var(--tgui--text_color)]" aria-live="polite">
                {unreadCount > 0
                  ? `Непрочитанных: ${unreadCount}.`
                  : "Все уведомления прочитаны."}
              </p>
            </div>
            <p className="text-[12px] text-[var(--tgui--hint_color)] leading-relaxed">
              Важные статусы поездки и брони сохраняются всегда, даже если
              некритичные уведомления выключены.
            </p>
            <div className="flex gap-2">
              <a
                className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[14px] font-medium bg-[var(--tgui--secondary_fill)] text-[var(--tgui--link_color)]"
                href="#/settings"
              >
                <Settings2 size={15} />
                Настройки уведомлений
              </a>
              <Button
                stretched
                size="s"
                mode="bezeled"
                className="min-h-[44px]"
                before={<CheckCheck size={15} />}
                loading={markAll.isPending}
                disabled={markAll.isPending || unreadCount === 0}
                onClick={() => markAll.mutate()}
              >
                Прочитать все
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs">
              <p className="text-[16px] font-semibold text-center text-[var(--tgui--text_color)]">
                Пока нет уведомлений
              </p>
              <p className="text-[13px] text-center text-[var(--tgui--hint_color)] mt-1">
                Подтверждения брони, отмены и завершение поездок появятся здесь
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3" aria-live="polite" aria-label="Список уведомлений">
              {items.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  marking={markRead.isPending}
                  onMarkRead={(id) => markRead.mutate(id)}
                />
              ))}
              {inbox.hasNextPage && (
                <Button
                  mode="bezeled"
                  stretched
                  className="min-h-[44px]"
                  loading={inbox.isFetchingNextPage}
                  disabled={inbox.isFetchingNextPage}
                  onClick={() => void inbox.fetchNextPage()}
                >
                  Показать ещё
                </Button>
              )}
            </div>
          )}
        </div>
      </QueryState>
    </section>
  );
}

/**
 * Уведомления — модальная шторка поверх «Профиля» (модель примера:
 * CreateTripModal/SettingsModal; в Telegram нет «новых страниц», только
 * модалки; роут /notifications остаётся источником правды ради диплинков
 * START_PARAM_ROUTES и точки входа из ProfilePage — тот же
 * navigate("/notifications")).
 *
 * a11y: telegram-ui Modal даёт role=dialog, Esc-закрытие (onOpenChange) и
 * focus-trap; список — aria-live, интерактив в теле — таргеты ≥44px (min-h),
 * ошибки — role=alert.
 */
export function NotificationsModal({
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
      header={<Modal.Header>Уведомления</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <NotificationsBody />
      </div>
    </Modal>
  );
}

/**
 * Роут /notifications: фон — «Профиль» (точка входа ProfilePage:329),
 * поверх — шторка inbox. Закрытие — назад по истории (native Back/Shell
 * backButton через handleModalBack), иначе fallback на /profile.
 * PageHeader с back-кнопкой внутри тела нет — закрытие через header модалки.
 */
export function NotificationsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <ProfilePage />
      <NotificationsModal open onClose={close} />
    </>
  );
}
