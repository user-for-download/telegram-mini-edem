import { useMemo, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Switcher, type SwitcherOption } from "@/ui/Switcher";
import { Section } from "@/ui/Section";
import { Cell } from "@/ui/Cell";
import { IconButton } from "@/ui/IconButton";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { FetchMore } from "@/ui/FetchMore";
import { Notice } from "@/ui/Notice";
import { Button } from "@/ui/Button";
import { ICON_TARGET } from "@/ui/classes";

import { CheckCheck } from "lucide-react";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
import { tripIdFromPath, useOpenTrip } from "@/hooks/useOpenTrip";
import {
  moscowDateLabel,
  moscowDayContext,
  moscowTimeLabel,
} from "@/utils/date";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
} from "@/components/Skeletons";
import { Page } from "@/ui/Page";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { ApiError } from "@/api/client";
import { type Notification } from "@edem/contracts";
import styles from "./NotificationsPage.module.css";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInboxQuery,
  useUnreadCountQuery,
} from "@/queries/useNotificationsQuery";
import { listBlockingError } from "@/helpers/listBlockingError";

/**
 * Fallback-карта маршрута по типу уведомления.
 *
 * Источник правды для тапа — серверный `Notification.deepLink`
 * (per-entity, напр. `/trips/<uuid>`); эта карта срабатывает только когда
 * deepLink не пришёл (легаси/сид-записи без него). Ссылки — на уровень
 * разделов: per-entity id в самой карте не выводится.
 * Неизвестные типы — без ссылки (честно null, не выдуманный маршрут).
 */
const NOTIFICATION_ROUTES: Readonly<Record<string, string>> = {
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

/**
 * Значение словаря ТОЛЬКО по собственному ключу.
 *
 * `type`/`action` приходят из ответа сервера. Прямая индексация объектного
 * литерала опасна: `["toString"]`, `["constructor"]`, `["__proto__"]`
 * разрешаются в унаследованные члены Object.prototype — это не строки, и
 * такое значение роняет рендер («Functions are not valid as a React child»).
 * Типы этого не ловят — проверяем и собственность ключа, и тип значения
 * (тот же приём, что в bookingErrors.codeMessage).
 */
function ownString(
  dict: Readonly<Record<string, string>>,
  key: string,
): string | null {
  if (!Object.hasOwn(dict, key)) return null;
  const value: unknown = Reflect.get(dict, key);
  return typeof value === "string" ? value : null;
}

export function notificationRoute(type: string): string | null {
  return ownString(NOTIFICATION_ROUTES, type);
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
const NOTIFICATION_ACTION_LABELS: Readonly<Record<string, string>> = {
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
  return ownString(NOTIFICATION_ACTION_LABELS, action);
}

/**
 * Вторая строка ячейки: «ФИО • действие» в одну строку. Части по
 * отдельности тоже валидны, обе пустые — строка скрывается.
 *
 * Пустая строка приравнена к отсутствию (`activeString`), потому что `??`
 * на `""` НЕ срабатывает: при `actorName: ""` выражение
 * `actorName ?? actionLabel` возвращало `""`, и метка действия
 * («отменил», «подтвердил») терялась вместе со всей строкой. Значение
 * приходит из сериализатора бэкенда, поэтому «пусто» может прийти как
 * именно `""`, а не `null`.
 */
function activeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatNotificationWho(
  actorName: string | null | undefined,
  actionLabel: string | null,
): string | null {
  const actor = activeString(actorName);
  if (actor && actionLabel) return `${actor} • ${actionLabel}`;
  return actor ?? actionLabel ?? null;
}

/**
 * Третья строка ячейки: «дата, время • цена • маршрут» (как в ячейках
 * заявок на бронирование). Сегодня — только время, иначе день
 * полностью. Пустые части пропускаются, всё пустое — null.
 */
/** Когда и сколько: «19 окт., 06:00 · 400 ₽» (сегодня — только время). */
export function formatTripMeta(input: {
  price?: number | null;
  departureAt?: string | null;
}): string | null {
  const parts: string[] = [];
  if (input.departureAt) {
    const date = new Date(input.departureAt);
    if (!Number.isNaN(date.getTime())) {
      // Время поездок — по Москве (moscowDayContext/moscowTimeLabel из
      // utils/date), как в карточках поездок. Сравнение дней — тоже по
      // московским ключам, иначе «сегодня» считается по местному календарю.
      const time = moscowTimeLabel(date);
      const { isToday, sameYear } = moscowDayContext(date);
      if (isToday) {
        parts.push(time);
      } else {
        parts.push(`${moscowDateLabel(date, !sameYear)}, ${time}`);
      }
    }
  }
  if (typeof input.price === "number") {
    parts.push(`${input.price} ₽`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Маршрут снапшота: «Вологда → Череповец». */
export function formatTripRoute(input: {
  from?: string | null;
  to?: string | null;
}): string | null {
  const route = [input.from, input.to].filter(Boolean).join(" → ");
  return route || null;
}

/**
 * Третья строка ячейки одной строкой: «дата, время • цена • маршрут».
 * Экспорт — контракт текста (тесты и aria-label); В РАЗМЕТКЕ мета и
 * маршрут стоят двумя строками (formatTripMeta / formatTripRoute), иначе
 * маршрут рвался посередине — «Вологда →» / «Сокол».
 */
export function formatTripDetail(input: {
  from?: string | null;
  to?: string | null;
  price?: number | null;
  departureAt?: string | null;
}): string | null {
  const meta = formatTripMeta(input);
  const route = formatTripRoute(input);
  const parts = [meta, route].filter(Boolean);
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
  const { isToday, sameYear } = moscowDayContext(date, now);
  if (isToday) {
    return moscowTimeLabel(date);
  }
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
  const metaLine = formatTripMeta({
    price: notification.tripPrice,
    departureAt: notification.tripDepartureAt,
  });
  const routeLine = formatTripRoute({
    from: notification.tripFrom,
    to: notification.tripTo,
  });
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

  // Строка — три смысловые строки: событие (title), «ФИО • действие»
  // (whoLine), «дата, время • цена • маршрут» (detailLine). Пустые строки
  // скрываются (легаси-записи без кода).
  //
  // Правая колонка — ВРЕМЯ уведомления сверху (по линии заголовка) и точка
  // непрочитанного снизу: язык чат-листа. Было наоборот — шеврон сверху и
  // дата под ним; дата висела по центру пустой колонки, шеврон читался как
  // «открыть» у каждой строки, а маршрут в третьей строке обрезался на
  // «Вологда → Чере…» из-за узкой колонки текста.
  //
  // Непрочитанное видно ещё и подложкой строки (data-unread в
  // NotificationsPage.module.css): после «Прочитать все» лента обязана
  // заметно измениться, а одна точка 6px этого не даёт.
  return (
    <Cell
      // Здесь div + role="button" + tabIndex СОЗНАТЕЛЬНО: ниже стоит СВОЙ
      // onKeyDown={handleKeyDown} — нативная кнопка активировалась бы ещё
      // и сама (Enter/Space), то есть двойной вызов. Переход на нативную
      // кнопку возможен только вместе с удалением собственного handleKeyDown.
      {...(interactive ? { type: "button" as const } : {})}
      className={styles.cell}
      data-unread={!notification.isRead ? "true" : undefined}
      subtitle={
        whoLine ? <span className={styles.who}>{whoLine}</span> : undefined
      }
      description={
        metaLine || routeLine ? (
          <span className={styles.detail}>
            {metaLine ? <span className={styles.meta}>{metaLine}</span> : null}
            {routeLine ? (
              <span className={styles.route}>{routeLine}</span>
            ) : null}
          </span>
        ) : undefined
      }
      after={
        <div className={styles.side}>
          <span className={styles.time}>
            {formatNotifTime(notification.createdAt)}
          </span>
          {!notification.isRead ? (
            <Badge
              type="dot"
              className={styles.unread}
              data-testid={`notification-unread-${notification.id}`}
            />
          ) : null}
        </div>
      }
      onClick={interactive ? activate : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      data-testid={`notification-cell-${notification.id}`}
    >
      <span className={styles.title}>{notification.title}</span>
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
  const openTrip = useOpenTrip();
  const inbox = useNotificationsInboxQuery(20, segment);
  const markRead = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();

  // Фильтр — серверный: бэкенд уже отдал нужный архив, клиент показывает
  // как есть (m3). «Новые» — очередь входящих (все типы, только непрочитанные).
  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  );
  const counter = useUnreadCountQuery();
  // Счётчик «Прочитать все» — ТОЛЬКО авторитетный unread-count: он один
  // для всех сегментов, тогда как inbox отдаётся с фильтром (?role=/
  // unreadOnly) и pages[0].unreadCount считает непрочитанные только
  // в ЭТОМ архиве.
  //
  // null = «неизвестно»: утверждать «все прочитаны» можно ТОЛЬКО когда
  // число известно и равно нулю. На неизвестном кнопка остаётся рабочей:
  // markAll от счётчика не зависит, гасить её нечем.
  // Бейдж таба живёт отдельно (AppRouter → useUnreadCountQuery).
  const unreadCount: number | null = counter.data ?? null;
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
    { value: "unread", label: "Новые" },
    { value: "driver", label: "Водитель" },
    { value: "passenger", label: "Пассажир" },
  ] as const satisfies ReadonlyArray<SwitcherOption<NotifSegment>>;

  /**
   * Тап по уведомлению. Детали поездки — шторка поверх ЭТОГО экрана:
   * без backgroundLocation под шторкой успевал отрисоваться «Поиск»
   * (роут /trips/:id), и переход выглядел как «сначала перекинуло на
   * другую вкладку, потом открылись детали». Остальные цели — обычная
   * навигация: они ведут на настоящие страницы.
   */
  const openTarget = (to: string) => {
    const tripId = tripIdFromPath(to);
    if (tripId) {
      openTrip(tripId);
      return;
    }
    navigate(to);
  };

  /** Переключение сегмента: «Новые» — канонический чистый /notifications. */
  const selectSegment = (next: NotifSegment) => {
    if (next === "unread") {
      searchParams.delete("segment");
    } else {
      searchParams.set("segment", next);
    }
    setSearchParams(searchParams);
  };

  // Сентинел автодогрузки inbox (тот же useNotificationsInboxQuery,
  // контракт cursor-пагинации не меняется; SSR — тихий фолбэк).
  const sentinelRef = useInfiniteSentinel({
    hasNextPage: inbox.hasNextPage,
    isFetchingNextPage: inbox.isFetchingNextPage,
    // Сбой курсорной страницы не гасит hasNextPage: без флага сентинел
    // снова входит во вьюпорт после схлопывания плейсхолдера и догрузка
    // зацикливается (MEMORY.md §18). Молчим до явного «Повторить загрузку».
    disabled: inbox.isFetchNextPageError,
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
    <Page>
      <VisuallyHidden Component="h1">Уведомления</VisuallyHidden>
      <MutationError error={markRead.error ?? markAll.error} />
      {inbox.data && inbox.error && !inbox.isFetchNextPageError && (
        <>
          <Notice tone="danger">Не удалось обновить уведомления. Показанные данные могут быть устаревшими.</Notice>
          <Button variant="ghost" onClick={() => void inbox.refetch()}>Повторить обновление уведомлений</Button>
        </>
      )}
      <QueryState
        loading={inbox.isLoading}
        error={listBlockingError(inbox)}
        empty={false}
        emptyText=""
        skeleton={<NotificationCardsSkeleton />}
        onRetry={() => void inbox.refetch()}
      >
        <>
          {/* Счётчик непрочитанных — независимый запрос: лента при его сбое
            остаётся в силе, поэтому здесь НЕ QueryState (он заменил бы всю
            страницу, как на CreateTripPage), а точечная плашка. */}
          {counter.isError ? (
            <Notice tone="danger" variant="banner">
              Не удалось загрузить счётчик непрочитанных — «Прочитать все»{" "}
              <Button
                variant="ghost"
                className={styles.retry}
                onClick={() => void counter.refetch()}
              >
                Повторить
              </Button>
            </Notice>
          ) : null}
          {/* Сверху ряд пилюль: сегменты Новые / Водитель / Пассажир +
            справа IconButton «Прочитать все» (CheckCheck) — голый div под
            Page (гуттер даёт сам Page, паттерн TripActivePage).
            Лента — прямые Cell внутри Section: кит сам вставляет Divider
            между строками (hairline-разделители, как в TripHistory).
            Пустое состояние — текст сегмента в теле Section. */}
          <div className={styles.chipRow}>
            <div className={styles.segments}>
              <Switcher
                options={FILTERS}
                value={segment}
                onChange={selectSegment}
                ariaLabel="Фильтр уведомлений"
                idPrefix="notif-segment"
              />
            </div>
            <div aria-live="polite">
              <IconButton
                // Круг 44×44 (ICON_TARGET, WCAG 2.5.5): кнопка стоит одна в
                // шапке и решает массовое действие, а родные 36×36 — меньше
                // пальца (тот же порог, что у иконок в строках заявок).
                className={ICON_TARGET}
                aria-label={
                  unreadCount === 0
                    ? "Все уведомления прочитаны"
                    : unreadCount === null
                      ? "Прочитать все"
                      : `Прочитать все (${unreadCount})`
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

          {items.length === 0 ? (
            /* Пустое состояние — прямо на фоне страницы, как на поиске.
               Было в SectionBody: Placeholder занимает 174px, а поверхность
               секции кончается на 306px — ниже пустоты шёл видимый шов
               (край поверхности), и экран выглядел обрезанным блоком. */
            <EmptyState
              header={emptyState.header}
              description={emptyState.description}
            />
          ) : (
            <Section>
              {items.map((notification) => (
                <NotificationCell
                  key={notification.id}
                  notification={notification}
                  marking={markingId === notification.id}
                  onMarkRead={(id) => markRead.mutate(id)}
                  onOpen={openTarget}
                />
              ))}
            </Section>
          )}

          {/* M1: конец ленты — по hasNextPage, а не по видимым: иначе пустой
              сегмент при непрочитанных на следующих страницах — тупик без
              кнопки и без сентинела автодогрузки. */}
          {(items.length > 0 || inbox.hasNextPage) && (
            <FetchMore
              hasNextPage={inbox.hasNextPage}
              isFetchingNextPage={inbox.isFetchingNextPage}
              fetchNextPage={() => void inbox.fetchNextPage()}
              error={inbox.isFetchNextPageError ? inbox.error : null}
              sentinelRef={sentinelRef}
              placeholder={<NotificationCardSkeleton />}
              placeholderLabel="Загрузка ещё уведомлений"
            />
          )}
        </>
      </QueryState>
    </Page>
  );
}
