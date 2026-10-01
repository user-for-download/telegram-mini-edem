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
 * Патч ОБОИХ кэшей при чтении одной записи: списки inbox (scope lists —
 * ключ счётчика под all, но НЕ под lists, число не трогаем) + декремент
 * счётчика, только если запись реально была непрочитанной.
 * Возвращает, был ли декремент (для тестов/вызывающих).
 */
export function applyMarkReadCaches(
  queryClient: QueryClient,
  updated: Notification,
): boolean {
  let decremented = false;
  queryClient.setQueriesData<InfiniteData<NotificationsPage>>(
    { queryKey: NOTIFICATION_KEYS.lists() },
    (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => {
          let pageDecremented = false;
          const items = page.items.map((item) => {
            if (item.id !== updated.id || item.isRead) return item;
            pageDecremented = true;
            return updated;
          });
          if (pageDecremented) decremented = true;
          return {
            ...page,
            items,
            unreadCount:
              page.unreadCount === undefined || !pageDecremented
                ? page.unreadCount
                : Math.max(0, page.unreadCount - 1),
          };
        }),
      };
    },
  );
  if (decremented) {
    queryClient.setQueryData<number>(
      NOTIFICATION_KEYS.unreadCount(),
      (count) =>
        typeof count === "number" ? Math.max(0, count - 1) : count,
    );
  }
  return decremented;
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

/**
 * Отметка одного уведомления прочитанным: оптимистично правим ОБА кэша
 * (списки inbox + счётчик бейджа), ресинк с сервером — по staleTime/рефетчу.
 */
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    // Откат оптимистичного кэша при ошибке (m2): blanket-инвалидация тянет
    // авторитетное состояние обоих кэшей (счётчик — тоже под all),
    // зависших «прочитанных» не остаётся.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
    onSuccess: (updated) => {
      applyMarkReadCaches(queryClient, updated);
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
