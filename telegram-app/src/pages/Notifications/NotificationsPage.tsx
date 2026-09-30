import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Banner,
  Caption,
  IconContainer,
  Section,
  Text,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { BTN_ROW, INFO, PROSE, SHRINK } from "@/ui/classes";
import { FetchMore } from "@/ui/FetchMore";

import { BellRing, CheckCheck, Info, Settings2, TriangleAlert } from "lucide-react";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
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
  booking_created: "/bookings?segment=requests",
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

export type NotifSegment = "unread" | "driver" | "passenger";

/**
 * Нормализация ?segment (зеркало normalizeSegment из TripActivePage):
 * driver/passenger — ролевые архивы, всё остальное (null, unread, all,
 * легаси) — очередь «Новые». Канонический URL — чистый /notifications.
 */
export function normalizeNotifSegment(raw: string | null): NotifSegment {
  if (raw === "driver") return "driver";
  if (raw === "passenger") return "passenger";
  return "unread";
}

/**
 * Карта type → роль получателя (сверена с backend по createNotification):
 * Водитель — booking_created (bookings/create.ts:276, получатель driverId),
 * ride_request_match (rideRequests/matching.ts:52, автор запроса);
 * Пассажир — booking_status_changed (bookings/status.ts:275),
 * trip_cancelled (trips/index.ts:1098, admin/index.ts:875),
 * trip_status_changed (trips/users/worker — все получатели пассажиры,
 * водительских отправок этого типа в коде нет),
 * trip_details_changed (trips/index.ts:946, confirmed passengers).
 * Нейтральные (review_approved/rejected, feedback_replied, unknown) —
 * ни в одной карте: видны только в «Новых», ролевые их не показывают.
 */
export const DRIVER_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "booking_created",
  "ride_request_match",
]);

export const PASSENGER_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "booking_status_changed",
  "trip_cancelled",
  "trip_status_changed",
  "trip_details_changed",
]);

export function notifSegmentOf(type: string): NotifSegment | null {
  if (DRIVER_NOTIFICATION_TYPES.has(type)) return "driver";
  if (PASSENGER_NOTIFICATION_TYPES.has(type)) return "passenger";
  return null;
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

function NotificationBanner({
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
  // Статус читается первым (callout над заголовком): критичное важнее
  // «нового», прочитанная некритичная — без статуса вообще.
  const callout = critical
    ? "Важное"
    : !notification.isRead
      ? "Новое"
      : undefined;
  const iconKind = critical
    ? "critical"
    : notification.type === "booking_created" ||
        notification.type === "ride_request_match" ||
        notification.type === "trip_details_changed"
      ? "request"
      : "feedback";
  // Тап по баннеру: непрочитанную помечаем прочитанной, затем уходим по
  // маршруту (если есть). Отдельных кнопок нет: «Прочитать все» сверху
  // закрывает массовый кейс (паттерн NextTripBanner: role/tabIndex/Enter/Space).
  const interactive = route !== null || !notification.isRead;
  const activate = () => {
    if (!interactive || marking) return;
    haptic.light();
    if (!notification.isRead) onMarkRead(notification.id);
    if (route) window.location.hash = `#${route}`;
  };
  const label = route
    ? `${notification.title}. ${notification.isRead ? "Открыть" : "Отметить прочитанным и открыть"}`
    : `${notification.title}. Отметить прочитанным`;
  return (
    <Banner
      type="inline"
      className={styles.banner}
      before={
        <IconContainer className={styles[`icon-${iconKind}`]}>
          {iconKind === "critical" ? (
            <TriangleAlert size={24} aria-hidden />
          ) : iconKind === "request" ? (
            <BellRing size={24} aria-hidden />
          ) : (
            <Info size={24} aria-hidden />
          )}
        </IconContainer>
      }
      callout={callout}
      header={notification.title}
      subheader={formatDate(notification.createdAt)}
      description={notification.body}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      onClick={interactive ? activate : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
      data-testid={`notification-banner-${notification.id}`}
    />
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
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = normalizeNotifSegment(searchParams.get("segment"));

  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  );
  const unreadCount = inbox.data?.pages[0]?.unreadCount ?? 0;

  // Фильтр сегментов — клиентский по загруженным страницам (как matchesQuery
  // в TripActivePage; backend без role — серверный ?role= не делаем).
  // «Новые» — очередь входящих (все типы, включая нейтральные);
  // ролевые — архивы по карте type→role (включая прочитанные).
  const visibleItems = useMemo(
    () =>
      segment === "unread"
        ? items.filter((n) => !n.isRead)
        : items.filter((n) => notifSegmentOf(n.type) === segment),
    [items, segment],
  );

  const emptyState =
    segment === "driver"
      ? EMPTY_STATES.notificationsDriverEmpty
      : segment === "passenger"
        ? EMPTY_STATES.notificationsPassengerEmpty
        : EMPTY_STATES.notificationsEmpty;

  const FILTERS = [
    { id: "unread", title: "Новые" },
    { id: "driver", title: "Водитель" },
    { id: "passenger", title: "Пассажир" },
  ] as const;

  const renderFilter = (id: NotifSegment, title: string) => (
    <Chip
      key={id}
      variant={segment === id ? "active" : "quiet"}
      tone={segment === id ? "accent" : "neutral"}
      aria-pressed={segment === id}
      onClick={() => {
        haptic.light();
        if (id === "unread") {
          searchParams.delete("segment");
        } else {
          searchParams.set("segment", id);
        }
        setSearchParams(searchParams);
      }}
      className={segment === id ? styles.filterActive : styles.filter}
    >
      {title}
    </Chip>
  );

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
            TripRequests, популярные). Сверху ряд сегментов (зеркало
            TripActivePage: Новые / Водитель / Пассажир); пустое состояние —
            текст сегмента, баннеры хранят свой хром. */}
          <Section>
            <div className={styles.chipRow} role="group" aria-label="Фильтр уведомлений">
              {FILTERS.map(({ id, title }) => renderFilter(id, title))}
            </div>
            <SectionBody>
              {visibleItems.length === 0 ? (
                <EmptyState
                  header={emptyState.header}
                  description={emptyState.description}
                />
              ) : (
                <>
                  {visibleItems.map((notification) => (
                    <NotificationBanner
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
