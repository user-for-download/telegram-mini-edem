import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { notificationsApi } from "@/api/notifications";
import type { NotificationsPage } from "@edem/contracts";
import type { NotifSegment } from "@/pages/Notifications/NotificationsPage";

export const NOTIFICATION_KEYS = {
  all: ["notifications"] as const,
  inbox: (limit: number, segment: NotifSegment = "unread") =>
    [...NOTIFICATION_KEYS.all, "inbox", limit, segment] as const,
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
 * Отметка одного уведомления прочитанным: оптимистично правим кэш inbox
 * (unreadCount первой страницы декрементируем только если запись реально
 * была непрочитанной), ресинк с сервером — по staleTime/рефетчу.
 */
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    // Откат оптимистичного кэша при ошибке (m2): инвалидация тянет
    // авторитетное состояние, зависших «прочитанных» не остаётся.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<InfiniteData<NotificationsPage>>(
        { queryKey: NOTIFICATION_KEYS.all },
        (data) => {
          if (!data) return data;
          return {
            ...data,
            pages: data.pages.map((page) => {
              let decremented = false;
              const items = page.items.map((item) => {
                if (item.id !== updated.id || item.isRead) return item;
                decremented = true;
                return updated;
              });
              return {
                ...page,
                items,
                unreadCount:
                  page.unreadCount === undefined || !decremented
                    ? page.unreadCount
                    : Math.max(0, page.unreadCount - 1),
              };
            }),
          };
        },
      );
    },
  });
}

/**
 * «Прочитать все»: гасим все записи и счётчики в кэше сразу —
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
      queryClient.setQueriesData<InfiniteData<NotificationsPage>>(
        { queryKey: NOTIFICATION_KEYS.all },
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
    },
  });
}
