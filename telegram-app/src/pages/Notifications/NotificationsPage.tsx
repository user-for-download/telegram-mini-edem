import { useMemo, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Info,
  Section,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Chip } from "@/ui/Chip";
import { Cell } from "@/ui/Cell";
import { IconButton } from "@/ui/IconButton";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { FetchMore } from "@/ui/FetchMore";

import { CheckCheck, ChevronRight } from "lucide-react";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
import { moscowDateLabel, moscowDayKey, moscowTimeLabel } from "@/utils/date";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
} from "@/components/Skeletons";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { ApiError } from "@/api/client";
import {
  CRITICAL_NOTIFICATION_TYPES,
  type Notification,
} from "@edem/contracts";
import styles from "./NotificationsPage.module.css";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInboxQuery,
  useUnreadCountQuery,
} from "@/queries/useNotificationsQuery";

/**
 * Критичные типы — единый источник CRITICAL_NOTIFICATION_TYPES
 * из @edem/contracts (там же backend и тесты контракта).
 * Реэкспорт для существующих импортов страницы/тестов.
 */
export { CRITICAL_NOTIFICATION_TYPES };

export function isCriticalNotification(type: string): boolean {
  return CRITICAL_NOTIFICATION_TYPES.has(type);
}

/**
 * Fallback-карта маршрута по типу уведомления.
 *
 * Источник правды для тапа — серверный `Notification.deepLink`
 * (per-entity, напр. `/trips/<uuid>`); эта карта срабатывает только когда
 * deepLink не пришёл (легаси/сид-записи без него). Ссылки — на уровень
 * разделов: per-entity id в самой карте не выводится.
 * Неизвестные типы — без ссылки (честно null, не выдуманный маршрут).
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

/**
 * Маршрут тапа по уведомлению: приоритет — серверный allowlist-deepLink
 * (per-entity, напр. `/trips/<uuid>` — шторка деталей поездки), иначе
 * fallback-карта по type. `deepLink` уже провалидирован бэкендом
 * (resolveTelegramDeepLink), поэтому здесь — только выбор источника.
 */
export function notificationTarget(notification: {
  type: string;
  deepLink?: string | null;
}): string | null {
  return notification.deepLink ?? notificationRoute(notification.type);
}

/**
 * Словарь действий для третьей строки ячейки (глаголы, как пишет рантайм
 * в `Notification.action`). Неизвестный/пустой код — null, строка
 * скрывается (легаси-записи без кода).
 */
export const NOTIFICATION_ACTION_LABELS: Readonly<Record<string, string>> = {
  created: "отправил заявку",
  confirmed: "подтвердил",
  declined: "отклонил",
  cancelled: "отменил",
  completed: "завершил",
  changed: "изменил",
  matched: "найдена поездка",
  replied: "ответил",
  approved: "опубликовал",
  rejected: "отклонил",
};

export function notificationActionLabel(
  action: string | null | undefined,
): string | null {
  if (!action) return null;
  return NOTIFICATION_ACTION_LABELS[action] ?? null;
}

/**
 * Вторая строка ячейки: «ФИО • действие» в одну строку. Части по
 * отдельности тоже валидны, обе пустые — строка скрывается.
 */
export function formatNotificationWho(
  actorName: string | null | undefined,
  actionLabel: string | null,
): string | null {
  if (actorName && actionLabel) return `${actorName} • ${actionLabel}`;
  return actorName ?? actionLabel ?? null;
}

/**
 * Третья строка ячейки: «дата, время • цена • маршрут» (как в ячейках
 * заявок на бронирование). Сегодня — только время, иначе день
 * полностью. Пустые части пропускаются, всё пустое — null.
 */
export function formatTripDetail(input: {
  from?: string | null;
  to?: string | null;
  price?: number | null;
  departureAt?: string | null;
}): string | null {
  const parts: string[] = [];
  if (input.departureAt) {
    const date = new Date(input.departureAt);
    if (!Number.isNaN(date.getTime())) {
      // Время поездок — по Москве (moscowDayKey/moscowTimeLabel из
      // utils/date), как в карточках поездок. Раньше здесь стояли
      // toLocale*("ru-RU") без timeZone, то есть зона УСТРОЙСТВА: у
      // клиента в Лос-Анджелесе «18:00 МСК» показывалось как «08:00».
      // Сравнение дней — тоже по московским ключам, иначе «сегодня»
      // считалось по местному календарю.
      const time = moscowTimeLabel(date);
      const dayKey = moscowDayKey(date);
      const todayKey = moscowDayKey(new Date());
      if (dayKey === todayKey) {
        parts.push(time);
      } else {
        const sameYear = dayKey.slice(0, 4) === todayKey.slice(0, 4);
        parts.push(`${moscowDateLabel(date, !sameYear)}, ${time}`);
      }
    }
  }
  if (typeof input.price === "number") {
    parts.push(`${input.price} ₽`);
  }
  const route = [input.from, input.to].filter(Boolean).join(" → ");
  if (route) parts.push(route);
  return parts.length > 0 ? parts.join(" · ") : null;
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
 * Карта type → роль получателя УДАЛЕНА (m3): единый источник
 * NOTIFICATION_ROLE_TYPES живёт в @edem/contracts, фильтр — серверный
 * (`GET /my?role=`). Клиент передаёт сегмент как есть и по типам
 * сам не фильтрует — иначе архивы дырявые и врут (ride_request_match
 * получатель — пассажир, trip_status_changed уходит и водителю).
 * Нейтральные (review_*, feedback_*) — только очередь «Новые», пока
 * непрочитаны: архивного дома у них нет (осознанно, без роли поездки).
 */

/**
 * Короткое время уведомления (верхняя строка справа, как в чат-листе):
 * сегодня — «ЧЧ:ММ», в этом году — «9 сен», иначе — с годом.
 * Экспорт — для юнит-теста (TZ-независимый кейс «сегодня»).
 */
export function formatNotifTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  // Тот же московский часовой пояс, что у времени поездок (B8): иначе
  // в уведомлении и в карточке одна и та же минута показывалась разными
  // часами у клиента не в московской зоне.
  const now = new Date();
  const dayKey = moscowDayKey(date);
  const todayKey = moscowDayKey(now);
  if (dayKey === todayKey) {
    return moscowTimeLabel(date);
  }
  const sameYear = dayKey.slice(0, 4) === todayKey.slice(0, 4);
  return moscowDateLabel(date, !sameYear);
}

function NotificationCell({
  notification,
  onMarkRead,
  marking,
  onOpen,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  marking: boolean;
  onOpen: (route: string) => void;
}) {
  const route = notificationTarget(notification);
  const actionLabel = notificationActionLabel(notification.action);
  // Строка 2 — «ФИО • действие» в одну строку; строка 3 — снапшот
  // поездки («дата, время • цена • маршрут»). Пустые скрываются.
  const whoLine = formatNotificationWho(notification.actorName, actionLabel);
  const detailLine = formatTripDetail({
    from: notification.tripFrom,
    to: notification.tripTo,
    price: notification.tripPrice,
    departureAt: notification.tripDepartureAt,
  });
  // Тап по ячейке: непрочитанную помечаем прочитанной, затем уходим по
  // маршруту (если есть). Отдельных кнопок нет: «Прочитать все» сверху
  // закрывает массовый кейс. Навигация — через роутер (m11), клавиатура —
  // role/табиндекс/Enter/Space: tgui Tappable на div их сам не даёт (M2).
  const interactive = route !== null || !notification.isRead;
  const activate = () => {
    if (!interactive || marking) return;
    haptic.light();
    if (!notification.isRead) onMarkRead(notification.id);
    if (route) onOpen(route);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };
  const label = [
    notification.title,
    whoLine ?? undefined,
    detailLine ?? undefined,
    route
      ? notification.isRead
        ? "Открыть"
        : "Отметить прочитанным и открыть"
      : !notification.isRead
        ? "Отметить прочитанным"
        : undefined,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(". ");

  // Строка — ровно три смысловые строки: событие (title),
  // «ФИО • действие» (whoLine), «дата, время • цена • маршрут»
  // (detailLine); всё однострочное с обрезкой (без multiline).
  // Пустые строки скрываются (легаси-записи без кода).
  // Аватара нет, статуса «Важное» нет — только три строки.
  // Правая колонка — штатный двустрочный Info кита: шеврон сверху,
  // время диммером снизу.
  return (
    <Cell
      // type="button" БЕЗ Component="button": корень остаётся div (как
      // PopularRoutesSection). Component="button" подменяет корень на
      // нативный <button> и ломает раскладку Cell (UA-стили кнопки).
      {...(interactive ? { type: "button" as const } : {})}
      className={styles.cell}
      titleBadge={
        !notification.isRead ? (
          <Badge
            type="dot"
            data-testid={`notification-unread-${notification.id}`}
          />
        ) : undefined
      }
      subtitle={whoLine ?? undefined}
      description={detailLine ?? undefined}
      after={
        <Info
          type="text"
          className={styles.info}
          subtitle={formatNotifTime(notification.createdAt)}
        >
          {route ? (
            <ChevronRight size={16} className={styles.chevron} aria-hidden />
          ) : null}
        </Info>
      }
      onClick={interactive ? activate : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      data-testid={`notification-cell-${notification.id}`}
    >
      {notification.title}
    </Cell>
  );
}

/**
 * Уведомления Telegram-пользователя (inbox — authoritative канал parity:
 * персист + WebSocket-хинт; фоновая отправка идёт на сервере через
 * outbox и на этот экран не влияет).
 *
 * - Cursor-пагинация (limit 20, «Показать ещё»);
 * - прочитать одно — оптимистично (точка и бейдж гаснут на тапе,
 *   откат из снапшота + инвалидация при ошибке), прочитать все — сразу;
 * - сегменты — серверный фильтр (?role=/unreadOnly), клиент типы не знает.
 */
export function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = normalizeNotifSegment(searchParams.get("segment"));
  const navigate = useNavigate();
  const inbox = useNotificationsInboxQuery(20, segment);
  const markRead = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();

  // Фильтр — серверный: бэкенд уже отдал нужный архив, клиент показывает
  // как есть (m3). «Новые» — очередь входящих (все типы, только непрочитанные).
  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  );
  const visibleItems = items;
  const counter = useUnreadCountQuery();
  // Счётчик «Прочитать все» — ТОЛЬКО авторитетный unread-count: он один
  // для всех сегментов, тогда как inbox отдаётся с фильтром (?role=/
  // unreadOnly) и pages[0].unreadCount считает непрочитанные только
  // В ЭТОМ архиве. Фолбэк на него показывал в действии «Прочитать
  // все (7)», хотя глобально непрочитанных 12, и кнопка при этом
  // гасилась зря. Пока счётчик грузится — 0 (B9).
  // Бейдж таба живёт отдельно (AppRouter → useUnreadCountQuery) и
  // правку не затрагивает.
  const unreadCount = counter.data ?? 0;
  // markRead.variables — id записи в полёте: блокируем только её ячейку (m1),
  // а не всю ленту.
  const markingId = markRead.isPending ? markRead.variables : undefined;

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
      // Нативную кнопку даёт дефолт ui/Chip: кликабельный чип (onClick)
      // рендерится как <button>. Явный Component не нужен.
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
          {/* Сверху ряд пилюль: сегменты Новые / Водитель / Пассажир +
            справа IconButton «Прочитать все» (CheckCheck) — голый div под
            Page (гуттер даёт сам Page, паттерн TripActivePage).
            Лента — прямые Cell внутри Section: кит сам вставляет Divider
            между строками (hairline-разделители, как в TripHistory).
            Пустое состояние — текст сегмента в теле Section. */}
          <div className={styles.chipRow}>
            <div
              className={styles.segments}
              role="group"
              aria-label="Фильтр уведомлений"
            >
              {FILTERS.map(({ id, title }) => renderFilter(id, title))}
            </div>
            <div aria-live="polite">
              <IconButton
                aria-label={
                  unreadCount > 0
                    ? `Прочитать все (${unreadCount})`
                    : "Все уведомления прочитаны"
                }
                disabled={markAll.isPending || unreadCount === 0}
                onClick={() => {
                  haptic.light();
                  markAll.mutate();
                }}
              >
                <CheckCheck size={20} />
              </IconButton>
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <Section>
              <SectionBody>
                <EmptyState
                  header={emptyState.header}
                  description={emptyState.description}
                />
              </SectionBody>
            </Section>
          ) : (
            <Section>
              {visibleItems.map((notification) => (
                <NotificationCell
                  key={notification.id}
                  notification={notification}
                  marking={markingId === notification.id}
                  onMarkRead={(id) => markRead.mutate(id)}
                  onOpen={(to) => navigate(to)}
                />
              ))}
            </Section>
          )}

          {/* M1: конец ленты — по hasNextPage, а не по видимым: иначе пустой
              сегмент при непрочитанных на следующих страницах — тупик без
              кнопки и без сентинела автодогрузки. */}
          {(visibleItems.length > 0 || inbox.hasNextPage) && (
            <FetchMore
              hasNextPage={inbox.hasNextPage}
              isFetchingNextPage={inbox.isFetchingNextPage}
              fetchNextPage={() => void inbox.fetchNextPage()}
              sentinelRef={sentinelRef}
              placeholder={<NotificationCardSkeleton />}
              placeholderLabel="Загрузка ещё уведомлений"
            />
          )}
        </Page>
      </QueryState>
    </>
  );
}
