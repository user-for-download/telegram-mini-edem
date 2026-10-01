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

const { mockGetMy } = vi.hoisted(() => ({
  mockGetMy: vi.fn(),
}));

vi.mock("@/api/notifications", () => ({
  notificationsApi: {
    getMy: mockGetMy,
  },
}));

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNotificationsInboxQuery } from "@/queries/useNotificationsQuery";

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
