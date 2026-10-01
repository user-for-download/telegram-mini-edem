import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { notificationsApi } from "@/api/notifications";
import type { Notification, NotificationsPage } from "@edem/contracts";
import type { NotifSegment } from "@/pages/Notifications/NotificationsPage";

export const NOTIFICATION_KEYS = {
  all: ["notifications"] as const,
  // Префикс списков inbox: узкие патчи/инвалидации бьют сюда, а не в all —
  // иначе заденут ключ счётчика (под all тоже лежит, значение — число).
  lists: () => [...NOTIFICATION_KEYS.all, "inbox"] as const,
  inbox: (limit: number, segment: NotifSegment = "unread") =>
    [...NOTIFICATION_KEYS.lists(), limit, segment] as const,
  unreadCount: () => [...NOTIFICATION_KEYS.all, "unread-count"] as const,
};

/**
 * Inbox уведомлений: cursor-пагинация backend (GET /notifications/my).
 * Фильтр — серверный: сегмент уходит в query (role/unreadOnly), клиент
 * по типам не фильтрует (m3). nextCursor === null означает конец списка —
 * getNextPageParam возвращает undefined и hasNextPage гаснет.
 */
export function useNotificationsInboxQuery(
  limit = 20,
  segment: NotifSegment = "unread",
) {
  return useInfiniteQuery({
    queryKey: NOTIFICATION_KEYS.inbox(limit, segment),
    queryFn: ({ pageParam, signal }) =>
      notificationsApi.getMy(pageParam, limit, signal, {
        role: segment === "unread" ? undefined : segment,
        unreadOnly: segment === "unread",
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

/**
 * Лёгкий счётчик непрочитанных для бейджа таба
 * (GET /notifications/unread-count). staleTime как у inbox: видимый список
 * и бейдж обновляются синхронно, WS-хинт инвалидирует оба ключа.
 */
export function useUnreadCountQuery() {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unreadCount(),
    queryFn: ({ signal }) => notificationsApi.getUnreadCount(signal),
    staleTime: 30_000,
  });
}

/**
 * Помечает запись прочитанной на одной странице inbox.
 *
 * ЧИСТАЯ функция: на входе данные, на выходе — новые (или те же) плюс
 * два признака для вызывающего. Побочных эффектов нет, поэтому её можно
 * звать и из обработчика апдейта, не нарушая чистоту react-query
 * (раньше флаг «была ли непрочитанной» мутировался прямо внутри
 * updater'а setQueriesData — B5).
 *
 * - `changed` — запись была НЕПРОЧИТАННОЙ: именно этот признак
 *   уменьшает счётчик (и page.unreadCount уменьшается на 1);
 * - `present` — запись вообще есть на этой странице. Позволяет отличить
 *   «уже прочитана» (present && !changed) от «её нет в кэше» (unknown).
 */
export function markReadInPages(
  data: InfiniteData<NotificationsPage> | undefined,
  id: string,
  patch: Partial<Notification>,
):
  | {
      data: InfiniteData<NotificationsPage>;
      changed: boolean;
      present: boolean;
    }
  | undefined {
  if (!data) return undefined;

  let changed = false;
  let present = false;
  const pages = data.pages.map((page) => {
    let pageWasUnread = false;
    const items = page.items.map((item) => {
      if (item.id !== id) return item;
      present = true;
      if (!item.isRead) pageWasUnread = true;
      // Патч мержится ВСЕГДА, даже для уже прочитанной записи: на
      // успехе сервер присылает актуальные поля (actor/deepLink/время),
      // а запись к этому моменту уже прочитана в кэше (оптимистичный
      // патч) — ранний return по isRead выбрасывал бы их.
      // isRead жёстко true: патч может не нести его.
      return { ...item, ...patch, isRead: true };
    });
    if (pageWasUnread) changed = true;
    const patched = items.some((item, index) => item !== page.items[index]);
    if (!patched) return page;
    return {
      ...page,
      items,
      unreadCount:
        pageWasUnread && typeof page.unreadCount === "number"
          ? Math.max(0, page.unreadCount - 1)
          : page.unreadCount,
    };
  });

  if (!present) return undefined;
  // Данные отдаём всегда: react-query применяет структурное разделение
  // (replaceEqualDeep), поэтому глубоко равный результат не создаст
  // новый объект и не вызовет ререндер.
  return { data: { ...data, pages }, changed, present };
}

/** Уменьшить счётчик бейджа на 1 (не ниже нуля). */
function decrementUnreadCount(queryClient: QueryClient): void {
  queryClient.setQueryData<number>(
    NOTIFICATION_KEYS.unreadCount(),
    (count) => (typeof count === "number" ? Math.max(0, count - 1) : count),
  );
}

/**
 * Патч ОБОИХ кэшей при чтении одной записи: списков inbox (scope
 * lists — ключ счётчика под all, но НЕ под lists) и счётчика бейджа.
 *
 * Чистая по построению: сначала читаем все совпавшие кэши, считаем
 * изменения в чистой markReadInPages, затем пишем. Декремент счётчика
 * ровно ОДИН на вызов, сколько бы сегментов ни содержало запись (B5).
 *
 * Если записи нет ни в одном кэше (сегмент переключили между рендером
 * и тапом), о прежнем состоянии неизвестно — не угадываем, а
 * перезапрашиваем авторитетный счётчик.
 *
 * Возвращает, был ли декремент (для тестов/вызывающих).
 */
export function applyMarkReadCaches(
  queryClient: QueryClient,
  id: string,
  patch: Partial<Notification>,
): boolean {
  const entries = queryClient.getQueriesData<InfiniteData<NotificationsPage>>({
    queryKey: NOTIFICATION_KEYS.lists(),
  });

  let changed = false;
  let present = false;
  for (const [key, data] of entries) {
    const result = markReadInPages(data, id, patch);
    if (!result) continue;
    present = present || result.present;
    changed = changed || result.changed;
    // Пишем всегда при present: на успехе это досинхронизация полей
    // записи сервером, даже если read-state уже применён оптимистично.
    queryClient.setQueryData(key, result.data);
  }

  if (changed) {
    decrementUnreadCount(queryClient);
  } else if (!present) {
    void queryClient.invalidateQueries({
      queryKey: NOTIFICATION_KEYS.unreadCount(),
    });
  }
  return changed;
}

/**
 * Патч ОБОИХ кэшей при «прочитать все»: списки гаснут полностью,
 * счётчик — в 0 (авторитетно: после read-all непрочитанных нет).
 */
export function applyMarkAllReadCaches(queryClient: QueryClient): void {
  queryClient.setQueriesData<InfiniteData<NotificationsPage>>(
    { queryKey: NOTIFICATION_KEYS.lists() },
    (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.isRead ? item : { ...item, isRead: true },
          ),
          unreadCount: 0,
        })),
      };
    },
  );
  queryClient.setQueryData<number>(NOTIFICATION_KEYS.unreadCount(), 0);
}

/** Снапшот кэшей для отката оптимистичного патча. */
interface MarkReadSnapshot {
  lists: Array<
    [readonly unknown[], InfiniteData<NotificationsPage> | undefined]
  >;
  count: number | undefined;
}

/**
 * Отметка одного уведомления прочитанным — ОПТИМИСТИЧНО: точка
 * непрочтения в ленте и счётчик бейджа гаснут на тапе, до ответа
 * сервера (B4 — раньше патч шёл в onSuccess, и докстринги обещали
 * оптимизм, которого не было).
 *
 * Откат: onMutate гасит текущие запросы и кладёт снапшот обоих
 * поддеревьев NOTIFICATION_KEYS.all; onError восстанавливает снапшот
 * и затем инвалидирует — авторитетное состояние всё равно забирает
 * сервер. onSuccess досинхронизирует запись целиком (сервер вернул
 * актуальные actor/deepLink/время), повторного декремента не будет:
 * в кэше запись уже прочитана, поэтому markReadInPages вернёт
 * present && !changed.
 */
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id): Promise<MarkReadSnapshot> => {
      // Гасим полёты: иначе ответ соседнего refetch вернул бы старые
      // данные поверх оптимистичного патча.
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_KEYS.all });
      const snapshot: MarkReadSnapshot = {
        lists: queryClient.getQueriesData<InfiniteData<NotificationsPage>>({
          queryKey: NOTIFICATION_KEYS.lists(),
        }),
        count: queryClient.getQueryData<number>(
          NOTIFICATION_KEYS.unreadCount(),
        ),
      };
      applyMarkReadCaches(queryClient, id, {});
      return snapshot;
    },
    onError: (_error, _id, snapshot) => {
      if (snapshot) {
        for (const [key, data] of snapshot.lists) {
          queryClient.setQueryData(key, data);
        }
        if (snapshot.count === undefined) {
          queryClient.removeQueries({
            queryKey: NOTIFICATION_KEYS.unreadCount(),
          });
        } else {
          queryClient.setQueryData(
            NOTIFICATION_KEYS.unreadCount(),
            snapshot.count,
          );
        }
      }
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
    onSuccess: (updated) => {
      applyMarkReadCaches(queryClient, updated.id, updated);
    },
  });
}

/**
 * «Прочитать все»: гасим записи и счётчик в кэше сразу —
 * backend-операция идемпотентна (updateMany isRead=false → true).
 */
export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
    onSuccess: () => {
      applyMarkAllReadCaches(queryClient);
    },
  });
}
