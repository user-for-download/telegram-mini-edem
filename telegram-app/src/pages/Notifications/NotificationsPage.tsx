import { useMemo } from "react";
import {
  Caption,
  Link,
  Section,
  Text,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { BTN_ROW, INFO, PROSE, SHRINK } from "@/ui/classes";
import { FetchMore } from "@/ui/FetchMore";

import { BellRing, CheckCheck, Settings2 } from "lucide-react";
import { MutationError } from "@/components/MutationError";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { Card } from "@/ui/Card";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
} from "@/components/Skeletons";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
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
  trip_status_changed: "/profile/history",
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
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <Text weight="2" Component="span">
          {notification.title}
        </Text>
        {critical ? (
          <StatusPill tone="danger" className={SHRINK}>
            Важное
          </StatusPill>
        ) : !notification.isRead ? (
          <StatusPill tone="info" className={SHRINK}>
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
            loading={marking}
            disabled={marking}
            onClick={() => onMarkRead(notification.id)}
          >
            Отметить прочитанным
          </Button>
        )}
      </div>
    </Card>
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
        <AccountStatePage
          title="Аккаунт заблокирован"
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
        <Page>
          {/* Инфо-панель: поверхность — Section без заголовка. */}
          <Section>
            <SectionBody>
              <div className={styles.unreadRow}>
                <BellRing size={16} className={`${INFO} ${SHRINK}`} />
                <Text Component="p" aria-live="polite">
                  {unreadCount > 0
                    ? `Непрочитанных: ${unreadCount}.`
                    : "Все уведомления прочитаны."}
                </Text>
              </div>
              <Caption Component="p" className={PROSE}>
                Важные статусы поездки и брони сохраняются всегда, даже если
                некритичные уведомления выключены.
              </Caption>
              <div className={BTN_ROW}>
                {/* Кнопка-ссылка: официальный паттерн tgui (стори Blocks/Button → Link):
                  Button с Component="a" вместо самописного <a> со стилями. */}
                <Button
                  Component="a"
                  href="#/settings"
                  size="s"
                  before={<Settings2 size={15} />}
                  className={styles.settingsBtn}
                >
                  Настройки уведомлений
                </Button>
                <Button
                  stretched
                  size="s"
                  before={<CheckCheck size={15} />}
                  loading={markAll.isPending}
                  disabled={markAll.isPending || unreadCount === 0}
                  onClick={() => markAll.mutate()}
                >
                  Прочитать все
                </Button>
              </div>
            </SectionBody>
          </Section>

          {/* Лента: поверхность — Section без заголовка (шаблон групп:
            TripRequests, популярные). Пустое состояние — тексты прямо
            на поверхности, карточки хранят свой хром (фаза 2). */}
          <Section>
            <SectionBody>
              {items.length === 0 ? (
                <EmptyState
                  header={EMPTY_STATES.notificationsEmpty.header}
                  description={EMPTY_STATES.notificationsEmpty.description}
                />
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
                  <FetchMore
                    hasNextPage={inbox.hasNextPage}
                    isFetchingNextPage={inbox.isFetchingNextPage}
                    fetchNextPage={() => void inbox.fetchNextPage()}
                    sentinelRef={sentinelRef}
                    placeholder={<NotificationCardSkeleton />}
                    placeholderLabel="Загрузка ещё уведомлений"
                  />
                </>
              )}
            </SectionBody>
          </Section>
        </Page>
      </QueryState>
    </>
  );
}
