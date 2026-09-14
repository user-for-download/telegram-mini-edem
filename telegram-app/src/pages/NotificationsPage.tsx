import { useMemo } from "react";
import { Button, Link, Placeholder, Section } from "@telegram-apps/telegram-ui";
import { BellRing, CheckCheck, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { FeedCard } from "@/components/FeedCard";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
} from "@/components/Skeletons";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { ApiError } from "@/api/client";
import type { Notification } from "@edem/contracts";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInboxQuery,
} from "@/queries/useNotificationsQuery";

/**
 * Типы, которые backend создаёт даже при выключенном тумблере
 * (зеркало CRITICAL_NOTIFICATION_TYPES из notification.service.ts).
 * Контракт: docs/migration/notification-parity-contract.md.
 */
export const CRITICAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "booking_status_changed",
  "trip_cancelled",
  "trip_status_changed",
]);

export function isCriticalNotification(type: string): boolean {
  return CRITICAL_NOTIFICATION_TYPES.has(type);
}

/**
 * Deep-link маршрута по типу уведомления (контракт parity).
 *
 * Notification не несёт entity-id (только id/userId/type/title/body),
 * поэтому ссылки — на уровень разделов, а не конкретных сущностей:
 * per-entity deep-links (trip_<uuid>, booking-specific) заблокированы,
 * пока payload не несёт идентификаторы. Неизвестные типы — без ссылки
 * (честно null, не выдуманный маршрут).
 */
export const NOTIFICATION_ROUTES: Readonly<Record<string, string>> = {
  booking_created: "/bookings?segment=driver",
  booking_status_changed: "/bookings",
  trip_cancelled: "/bookings",
  trip_status_changed: "/bookings?segment=history",
  trip_details_changed: "/trips",
  ride_request_match: "/trips",
  review_approved: "/reviews",
  review_rejected: "/reviews",
  feedback_replied: "/profile/support",
};

export function notificationRoute(type: string): string | null {
  return NOTIFICATION_ROUTES[type] ?? null;
}

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

function NotificationCard({
  notification,
  onMarkRead,
  marking,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  marking: boolean;
}) {
  const route = notificationRoute(notification.type);
  const critical = isCriticalNotification(notification.type);
  return (
    <FeedCard className="p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-(--tgui--text_color)">
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
      <p className="text-[13px] text-(--tgui--text_color) leading-relaxed wrap-anywhere">
        {notification.body}
      </p>
      <span className="text-[11px] text-(--tgui--hint_color)">
        {formatDate(notification.createdAt)}
      </span>
      <div className="flex items-center gap-3 pt-1 border-t border-(--tgui--outline)">
        {route && (
          <Link href={`#${route}`}>
            Открыть
          </Link>
        )}
        {!notification.isRead && (
          <Button
            size="s"
            mode="bezeled"
            loading={marking}
            disabled={marking}
            onClick={() => onMarkRead(notification.id)}
          >
            Отметить прочитанным
          </Button>
        )}
      </div>
    </FeedCard>
  );
}

/**
 * Уведомления Telegram-пользователя (inbox — authoritative канал parity:
 * персист + WebSocket-хинт, Bot API — blocked и здесь не предполагается).
 *
 * - Cursor-пагинация (limit 20, «Показать ещё»);
 * - прочитать одно / прочитать все (оптимистичный кэш);
 * - критичные статусы всегда в inbox независимо от тумблера
 *   (подпись + ссылка на /settings).
 */
export function NotificationsPage() {
  const inbox = useNotificationsInboxQuery(20);
  const markRead = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();

  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  );
  const unreadCount = inbox.data?.pages[0]?.unreadCount ?? 0;

  // Сентинел автодогрузки inbox (тот же useNotificationsInboxQuery,
  // контракт cursor-пагинации не меняется; SSR — тихий фолбэк).
  const sentinelRef = useInfiniteSentinel({
    hasNextPage: inbox.hasNextPage,
    isFetchingNextPage: inbox.isFetchingNextPage,
    fetchNextPage: () => {
      void inbox.fetchNextPage();
    },
  });

  // Бан mid-session: requireUser отвечает 403 — терминальный экран вместо
  // общей ошибки (паттерн ProfilePage; глобальные случаи закрывает AuthGate).
  if (inbox.error instanceof ApiError && inbox.error.status === 403) {
    return (
      <>
        <PageHeader title="Уведомления" />
        <Placeholder
          header="Аккаунт заблокирован"
          description="Действие недоступно: аккаунт заблокирован."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Уведомления" />
      <MutationError error={markRead.error ?? markAll.error} />
      <QueryState
        loading={inbox.isLoading}
        error={inbox.error}
        empty={false}
        emptyText=""
        skeleton={<NotificationCardsSkeleton />}
        onRetry={() => void inbox.refetch()}
      >
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        {/* Инфо-панель: поверхность — Section без заголовка. */}
        <Section>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <BellRing size={16} className="text-(--app-info) shrink-0" />
              <p className="text-[14px] text-(--tgui--text_color)" aria-live="polite">
                {unreadCount > 0
                  ? `Непрочитанных: ${unreadCount}.`
                  : "Все уведомления прочитаны."}
              </p>
            </div>
            <p className="text-[12px] text-(--tgui--hint_color) leading-relaxed">
              Важные статусы поездки и брони сохраняются всегда, даже если
              некритичные уведомления выключены.
            </p>
            <div className="flex gap-2">
              {/* Кнопка-ссылка: официальный паттерн tgui (стори Blocks/Button → Link):
                  Button с Component="a" вместо самописного <a> со стилями. */}
              <Button
                Component="a"
                href="#/settings"
                mode="bezeled"
                size="s"
                before={<Settings2 size={15} />}
                className="flex-1"
              >
                Настройки уведомлений
              </Button>
              <Button
                stretched
                size="s"
                mode="bezeled"
                before={<CheckCheck size={15} />}
                loading={markAll.isPending}
                disabled={markAll.isPending || unreadCount === 0}
                onClick={() => markAll.mutate()}
              >
                Прочитать все
              </Button>
            </div>
          </div>
        </Section>

        {items.length === 0 ? (
          <FeedCard className="p-4">
            <p className="text-[16px] font-semibold text-center text-(--tgui--text_color)">
              Пока нет уведомлений
            </p>
            <p className="text-[13px] text-center text-(--tgui--hint_color) mt-1">
              Подтверждения брони, отмены и завершение поездок появятся здесь
            </p>
          </FeedCard>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                marking={markRead.isPending}
                onMarkRead={(id) => markRead.mutate(id)}
              />
            ))}
            {inbox.hasNextPage && (
              <>
                {/* Якорь автодогрузки: скрыт от скринридера, фиксированная
                    высота (min-h-12) держит скролл от прыжков. */}
                <div
                  ref={sentinelRef}
                  aria-hidden="true"
                  className="flex min-h-12 items-center justify-center"
                  style={{ overflowAnchor: "none" }}
                />
                {inbox.isFetchingNextPage && (
                  <div
                    role="status"
                    aria-label="Загрузка ещё уведомлений"
                    className="flex flex-col gap-3"
                  >
                    <NotificationCardSkeleton />
                  </div>
                )}
                <Button
                  mode="bezeled"
                  stretched
                  loading={inbox.isFetchingNextPage}
                  disabled={inbox.isFetchingNextPage}
                  onClick={() => void inbox.fetchNextPage()}
                >
                  Показать ещё
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      </QueryState>
    </>
  );
}
