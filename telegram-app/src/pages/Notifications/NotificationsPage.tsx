import { useMemo } from "react";
import {
  Button,
  Caption,
  Link,
  Placeholder,
  Section,
  Text,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { BellRing, CheckCheck, Settings2 } from "lucide-react";
import { MutationError } from "@/components/MutationError";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { FeedCard } from "@/components/FeedCard/FeedCard";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
} from "@/components/Skeletons";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { ApiError } from "@/api/client";
import type { Notification } from "@edem/contracts";
import styles from "./NotificationsPage.module.css";
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
    <FeedCard className={styles.card}>
      <div className={styles.cardHead}>
        <Text weight="2" Component="span">
          {notification.title}
        </Text>
        {critical ? (
          <StatusPill tone="danger" className={styles.pill}>
            Важное
          </StatusPill>
        ) : !notification.isRead ? (
          <StatusPill tone="info" className={styles.pill}>
            Новое
          </StatusPill>
        ) : null}
      </div>
      <Text Component="p" className={styles.body}>
        {notification.body}
      </Text>
      <Caption Component="span">{formatDate(notification.createdAt)}</Caption>
      <div className={styles.cardFoot}>
        {route && <Link href={`#${route}`}>Открыть</Link>}
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
        {/* Таб-страницы без визуального заголовка (как Главная/Поездки/
            Профиль/Поиск — позицию показывает таббар): h1 только для
            скринридера. */}
        <VisuallyHidden Component="h1">Уведомления</VisuallyHidden>
        <Placeholder
          header="Аккаунт заблокирован"
          description="Действие недоступно: аккаунт заблокирован."
        />
      </>
    );
  }

  return (
    <>
      <VisuallyHidden Component="h1">Уведомления</VisuallyHidden>
      <MutationError error={markRead.error ?? markAll.error} />
      <QueryState
        loading={inbox.isLoading}
        error={inbox.error}
        empty={false}
        emptyText=""
        skeleton={<NotificationCardsSkeleton />}
        onRetry={() => void inbox.refetch()}
      >
        <div className={styles.wrap}>
          {/* Инфо-панель: поверхность — Section без заголовка. */}
          <Section>
            <div className={styles.panel}>
              <div className={styles.unreadRow}>
                <BellRing size={16} className={styles.bell} />
                <Text Component="p" aria-live="polite">
                  {unreadCount > 0
                    ? `Непрочитанных: ${unreadCount}.`
                    : "Все уведомления прочитаны."}
                </Text>
              </div>
              <Caption Component="p" className={styles.note}>
                Важные статусы поездки и брони сохраняются всегда, даже если
                некритичные уведомления выключены.
              </Caption>
              <div className={styles.actions}>
                {/* Кнопка-ссылка: официальный паттерн tgui (стори Blocks/Button → Link):
                  Button с Component="a" вместо самописного <a> со стилями. */}
                <Button
                  Component="a"
                  href="#/settings"
                  mode="bezeled"
                  size="s"
                  before={<Settings2 size={15} />}
                  className={styles.settingsBtn}
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

          {/* Лента: поверхность — Section без заголовка (шаблон групп:
            TripRequests, популярные). Пустое состояние — тексты прямо
            на поверхности, карточки хранят свой хром (фаза 2). */}
          <Section>
            <div className={styles.panel}>
              {items.length === 0 ? (
                <>
                  <Text weight="2" Component="p" className={styles.emptyText}>
                    Пока нет уведомлений
                  </Text>
                  <Caption Component="p" className={styles.emptyText}>
                    Подтверждения брони, отмены и завершение поездок появятся
                    здесь
                  </Caption>
                </>
              ) : (
                <>
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
                        высота (48px) держит скролл от прыжков. */}
                      <div
                        ref={sentinelRef}
                        aria-hidden="true"
                        className={styles.sentinel}
                        style={{ overflowAnchor: "none" }}
                      />
                      {inbox.isFetchingNextPage && (
                        <div
                          role="status"
                          aria-label="Загрузка ещё уведомлений"
                          className={styles.fetchMore}
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
                </>
              )}
            </div>
          </Section>
        </div>
      </QueryState>
    </>
  );
}
