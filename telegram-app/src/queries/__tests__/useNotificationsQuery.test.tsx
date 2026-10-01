// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Item 10 (m3): сегмент уходит в серверный фильтр. Страница мокает хук
 * целиком (notificationsPage.test.tsx), поэтому здесь — живой прогон
 * useNotificationsInboxQuery с моком notificationsApi: проверяем, что
 * сегмент превращается в role/unreadOnly для GET /notifications/my и что
 * ключ кэша включает сегмент (архивы не делят кэш с «Новыми»).
 */

const { mockGetMy, mockMarkRead, mockGetUnreadCount, mockMarkAllRead } =
  vi.hoisted(() => ({
    mockGetMy: vi.fn(),
    mockMarkRead: vi.fn(),
    mockGetUnreadCount: vi.fn(),
    mockMarkAllRead: vi.fn(),
  }));

vi.mock("@/api/notifications", () => ({
  notificationsApi: {
    getMy: mockGetMy,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
    getUnreadCount: mockGetUnreadCount,
  },
}));

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import type { Notification, NotificationsPage } from "@edem/contracts";
import {
  NOTIFICATION_KEYS,
  applyMarkReadCaches,
  markReadInPages,
  useMarkNotificationReadMutation,
  useNotificationsInboxQuery,
} from "@/queries/useNotificationsQuery";

let queryClient: QueryClient;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

function InboxProbe({
  limit,
  segment,
}: {
  limit: number;
  segment?: "unread" | "driver" | "passenger";
}) {
  useNotificationsInboxQuery(limit, segment);
  return null;
}

async function renderProbe(node: ReactNode): Promise<void> {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
    );
  });
  // Запрос резолвится цепочкой микрозадач — дренируем их внутри act,
  // чтобы queryFn успел отработать до ассёртов.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockGetMy.mockReset();
  mockGetMy.mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0 });
  mockMarkRead.mockReset();
  mockGetUnreadCount.mockReset();
  mockGetUnreadCount.mockResolvedValue(0);
  mockMarkAllRead.mockReset();
  mockMarkAllRead.mockResolvedValue({ success: true });

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

describe("useNotificationsInboxQuery: сегмент уходит в фильтр API (item 10)", () => {
  it("driver → getMy с role=driver, без unreadOnly", async () => {
    await renderProbe(<InboxProbe limit={20} segment="driver" />);

    expect(mockGetMy).toHaveBeenCalledWith(
      undefined,
      20,
      expect.anything(),
      { role: "driver", unreadOnly: false },
    );
  });

  it("passenger → getMy с role=passenger, без unreadOnly", async () => {
    await renderProbe(<InboxProbe limit={20} segment="passenger" />);

    expect(mockGetMy).toHaveBeenCalledWith(
      undefined,
      20,
      expect.anything(),
      { role: "passenger", unreadOnly: false },
    );
  });

  it("unread (дефолт) → getMy с unreadOnly=true и без role", async () => {
    await renderProbe(<InboxProbe limit={20} />);

    expect(mockGetMy).toHaveBeenCalledWith(
      undefined,
      20,
      expect.anything(),
      { role: undefined, unreadOnly: true },
    );
  });

  it("ключ кэша включает сегмент: разные архивы — разные запросы", async () => {
    // Без сегмента в ключе второй рендер переиспользовал бы кэш первого
    // и getMy не вызвался бы повторно.
    await renderProbe(<InboxProbe limit={20} segment="driver" />);
    await renderProbe(<InboxProbe limit={20} segment="passenger" />);

    expect(mockGetMy).toHaveBeenCalledTimes(2);
  });
});


/* ───────────────────────── B4/B5: кэш при чтении ───────────────────────── */

type ListData = InfiniteData<NotificationsPage>;

/** Запись контракта целиком — иначе zod-типы теста расходятся с продом. */
function makeNotification(id: string, isRead: boolean): Notification {
  return {
    id,
    userId: "u-1",
    type: "booking_created",
    title: "Новая заявка",
    body: "Иван отправил заявку",
    isRead,
    deepLink: "/bookings",
    actorName: "Иван",
    action: "created",
    tripFrom: "Москва",
    tripTo: "Тула",
    tripPrice: 500,
    tripDepartureAt: "2030-06-01T09:00:00.000Z",
    createdAt: "2030-05-01T09:00:00.000Z",
  };
}

function seedList(
  client: QueryClient,
  segment: "unread" | "driver" | "passenger",
  notificationId: string,
  isRead: boolean,
  unreadCount: number,
): void {
  client.setQueryData<ListData>([...NOTIFICATION_KEYS.inbox(20, segment)], {
    pages: [
      {
        items: [makeNotification(notificationId, isRead)],
        nextCursor: null,
        unreadCount,
      },
    ],
    pageParams: [undefined],
  });
}

function readItem(
  client: QueryClient,
  segment: "unread" | "driver" | "passenger",
): Notification {
  const data = client.getQueryData<ListData>([
    ...NOTIFICATION_KEYS.inbox(20, segment),
  ]);
  const item = data?.pages[0]?.items[0];
  if (!item) throw new Error(`нет записи в сегменте ${segment}`);
  return item;
}

/** Инфраструктура для тестов чистой функции. */
function listOf(
  notification: Notification,
  unreadCount: number,
): ListData {
  return {
    pages: [
      { items: [notification], nextCursor: null, unreadCount },
    ],
    pageParams: [undefined],
  };
}

describe("markReadInPages: чистая функция (B5)", () => {
  it("меняет запись и page.unreadCount, не трогая входные данные", () => {
    const input = listOf(makeNotification("n-1", false), 1);

    const result = markReadInPages(input, "n-1", { actorName: "Иван" });

    expect(result?.changed).toBe(true);
    expect(result?.present).toBe(true);
    expect(result?.data.pages[0]?.items[0]).toMatchObject({
      id: "n-1",
      isRead: true,
      actorName: "Иван",
    });
    expect(result?.data.pages[0]?.unreadCount).toBe(0);
    // Вход не мутирован — на этом и строится откат.
    expect(input.pages[0]?.items[0]?.isRead).toBe(false);
    expect(input.pages[0]?.unreadCount).toBe(1);
  });

  it("already-read: present, но без декремента", () => {
    const input = listOf(makeNotification("n-1", true), 0);

    const result = markReadInPages(input, "n-1", {});

    expect(result?.present).toBe(true);
    expect(result?.changed).toBe(false);
    expect(result?.data.pages[0]?.unreadCount).toBe(0);
  });

  it("записи нет — undefined (нетронутое состояние)", () => {
    const input = listOf(makeNotification("n-2", false), 1);

    expect(markReadInPages(input, "n-1", {})).toBeUndefined();
    expect(markReadInPages(undefined, "n-1", {})).toBeUndefined();
  });
});

describe("applyMarkReadCaches: счётчик (B5)", () => {
  it("одна запись в трёх сегментах — счётчик уменьшается РОВНО на 1", () => {
    const client = new QueryClient();
    seedList(client, "unread", "n-1", false, 3);
    seedList(client, "driver", "n-1", false, 2);
    seedList(client, "passenger", "n-1", false, 1);
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 6);

    const changed = applyMarkReadCaches(client, "n-1", {});

    expect(changed).toBe(true);
    // Кэш бейджа уменьшился один раз, а не по разу на сегмент.
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(5);
    for (const segment of ["unread", "driver", "passenger"] as const) {
      expect(readItem(client, segment).isRead).toBe(true);
    }
  });

  it("записи нет ни в одном кэше — счётчик не угадывается, а перезапрашивается", () => {
    const client = new QueryClient();
    // Счётчика в кэше нет вовсе — decrement нечего, и «была ли
    // непрочитанной» неизвестно: invalidate вместо догадки.
    const spy = vi.spyOn(client, "invalidateQueries");

    const changed = applyMarkReadCaches(client, "n-9", {});

    expect(changed).toBe(false);
    expect(spy).toHaveBeenCalledWith({
      queryKey: NOTIFICATION_KEYS.unreadCount(),
    });
  });

  it("счётчик не уходит в минус", () => {
    const client = new QueryClient();
    seedList(client, "unread", "n-1", false, 0);
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 0);

    applyMarkReadCaches(client, "n-1", {});

    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(0);
  });
});

describe("useMarkNotificationReadMutation: оптимизм и откат (B4)", () => {
  /** Кнопка вместо mutate() в эффекте: нет exhaustive-deps-зависимостей,
   *  и «оптимизм до ответа» видно буквально — клик, потом ассёрт. */
  function MutationProbe({ id }: { id: string }) {
    const mutation = useMarkNotificationReadMutation();
    return (
      <button type="button" onClick={() => mutation.mutate(id)}>
        прочитать
      </button>
    );
  }

  function clickRead(): void {
    fireEvent.click(
      document.querySelector("button") as HTMLButtonElement,
    );
  }

  async function renderMutation(node: ReactNode, client: QueryClient) {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={client}>{node}</QueryClientProvider>,
      );
    });
  }

  it("точка и счётчик гаснут ДО ответа сервера", async () => {
    const client = new QueryClient();
    seedList(client, "unread", "n-1", false, 2);
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 2);

    // Ответ сервера не приходит — оптимистичный патч обязан быть виден.
    let release: (value: unknown) => void = () => {};
    mockMarkRead.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await renderMutation(<MutationProbe id="n-1" />, client);
    expect(readItem(client, "unread").isRead).toBe(false);

    await act(async () => {
      clickRead();
    });

    // Сервер ещё не ответил — точка и счётчик уже обновлены.
    expect(readItem(client, "unread").isRead).toBe(true);
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(1);

    await act(async () => {
      release(makeNotification("n-1", true));
    });
  });

  it("ошибка откатывает оба кэша к снапшоту", async () => {
    const client = new QueryClient();
    seedList(client, "unread", "n-1", false, 2);
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 2);

    mockMarkRead.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(client, "invalidateQueries");

    await renderMutation(<MutationProbe id="n-1" />, client);
    await act(async () => {
      clickRead();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Откат: запись снова непрочитанная, счётчик восстановлен.
    expect(readItem(client, "unread").isRead).toBe(false);
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(2);
    // Плюс авторитетная инвалидация обоих поддеревьев.
    expect(spy).toHaveBeenCalledWith({ queryKey: NOTIFICATION_KEYS.all });
  });

  it("успех досинхронизирует запись целиком, счётчик второй раз не трогает", async () => {
    const client = new QueryClient();
    seedList(client, "unread", "n-1", false, 2);
    client.setQueryData(NOTIFICATION_KEYS.unreadCount(), 2);

    mockMarkRead.mockResolvedValue({
      ...makeNotification("n-1", true),
      actorName: "Сергей",
    });

    await renderMutation(<MutationProbe id="n-1" />, client);
    await act(async () => {
      clickRead();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const data = client.getQueryData<ListData>([
      ...NOTIFICATION_KEYS.inbox(20, "unread"),
    ]);
    expect(data?.pages[0]?.items[0]?.isRead).toBe(true);
    expect(data?.pages[0]?.items[0]).toMatchObject({ actorName: "Сергей" });
    // onSuccess не должен декрементить повторно (в кэше уже прочитано).
    expect(client.getQueryData(NOTIFICATION_KEYS.unreadCount())).toBe(1);
  });
});
