// @vitest-environment jsdom
// F21: «О себе» на странице профиля — тот же свободный текст человека, что
// жалоба и комментарий водителя, и на двух других экранах он уже идёт через
// фасад `ui/Blockquote` (жалоба — pages/Reports, шторка профиля —
// components/Profile/UserProfileSheet). Страница была исключением: голый
// `Caption` без единого правила переноса, поэтому перенос в «О себе»
// схлопывался, а длинное слово без пробела выдавливало строку.
//
// ЧТО ИМЕННО ПРОВЕРЯЕМ: узел, который НЕСЁТ ТЕКСТ, имеет тот же класс
// `.quote` из ui/ui.module.css, что и в шторке профиля. Правило класса
// закреплено отдельно в ui/__tests__/blockquoteWrapping.test.ts. САМ
// ВИЗУАЛЬНЫЙ ИТОГ (перенос на экране) в jsdom непроверяем — это работа e2e.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockUseProfile, mockUseDeleteAccount, mockUseNotifSettings } =
  vi.hoisted(() => ({
    mockUseProfile: vi.fn(),
    mockUseDeleteAccount: vi.fn(),
    mockUseNotifSettings: vi.fn(),
  }));

// Частичный мок: страница тянет из модуля ещё useProfileUpdateMutation —
// голый объект рвал бы на отсутствующем экспорте.
vi.mock("@/queries/profile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/profile")>();
  return {
    ...original,
    useProfileQuery: mockUseProfile,
    useDeleteAccountMutation: mockUseDeleteAccount,
    useProfileNotificationSettingsMutation: mockUseNotifSettings,
  };
});
// Реальный useSignal в jsdom тянет getSnapshot и падает (конвенция из
// AppConfig.test.tsx): сигнал-замыкание вызывается напрямую.
vi.mock("@tma.js/sdk-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tma.js/sdk-react")>();
  return {
    ...original,
    miniApp: { ready: { ifAvailable: vi.fn() }, isDark: () => false },
    useSignal: (signal: () => unknown) => signal(),
  };
});

import { ProfilePage } from "@/pages/Profile/ProfilePage";
import uiStyles from "@/ui/ui.module.css";

afterEach(cleanup);

const QUOTE_CLASS: string = uiStyles.quote as string;

/** Перенос строки и длинный токен без пробела — два настоящих случая F21. */
const ABOUT =
  "вожу аккуратно\nне беру животных\nhttps://example.com/" +
  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage(): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  const { container } = render(
    <AppRoot platform="base">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/profile"]}>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(
    queryState({
      data: {
        id: "user-1",
        name: "Александр",
        avatar: null,
        about: ABOUT,
        rating: 4.9,
        reviewsCount: 12,
        tripsCount: 42,
        notificationsEnabled: true,
        car: null,
      },
    }),
  );
  mockUseDeleteAccount.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  mockUseNotifSettings.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
});

/**
 * Узел-родитель ТЕКСТОВОГО узла «О себе». Именно на нём сидит класс
 * плашки; поиск по textContent нашёл бы внешний контейнер секции.
 */
function aboutTextParent(container: HTMLElement): HTMLElement {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue === ABOUT) {
      const parent = node.parentElement;
      if (parent === null) throw new Error("у текста «О себе» нет родителя");
      return parent;
    }
  }
  throw new Error("текст «О себе» не найден в DOM");
}

describe("ProfilePage: «О себе» идёт через ui/Blockquote", () => {
  it("узел, несущий текст «О себе», имеет класс плашки .quote", () => {
    // ГЛАВНЫЙ пин F21. До правки здесь был `Caption` с классом `.hint`, и
    // проверка падала: на узле с текстом не было класса плашки.
    expect(aboutTextParent(renderPage()).classList.contains(QUOTE_CLASS)).toBe(
      true,
    );
  });

  it("переносы в «О себе» доезжают до DOM как есть, без склейки", () => {
    expect(aboutTextParent(renderPage()).textContent).toBe(ABOUT);
  });

  it("«О себе» и на странице, и в шторке профиля идут через один фасад", () => {
    // Паритет между двумя экранами с одним и тем же полем: страница была
    // исключением, и «починить только её» — значит оставить два вида «О себе».
    // Шторку целиком в jsdom не рендерим (Modal + useUserQuery), поэтому
    // пин на исходник — он и хранит решение, а не результат рендера.
    // Путь от process.cwd(), а не от import.meta.url: в jsdom-окружении
    // тот не file: (та же причина, что в nextTripBanner.focus.dom.test.tsx).
    const sheet = readFileSync(
      join(process.cwd(), "src/components/Profile/UserProfileSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain("<Blockquote>{shown.about}</Blockquote>");
  });
});
