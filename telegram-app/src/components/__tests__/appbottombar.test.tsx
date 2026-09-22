// SSR-тесты AppBottomBar: нижний бар (nav + 6 табов в нативном Tabbar,
// бейдж) и Shell (табы всегда, семантика nav). Только renderToString,
// без jsdom.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@telegram-apps/sdk-react", () => ({
  backButton: {
    onClick: vi.fn(),
    offClick: vi.fn(),
    show: { ifAvailable: vi.fn() },
    hide: { ifAvailable: vi.fn() },
  },
  settingsButton: {
    show: { ifAvailable: vi.fn() },
    hide: { ifAvailable: vi.fn() },
    onClick: { ifAvailable: vi.fn() },
    offClick: { ifAvailable: vi.fn() },
  },
  useLaunchParams: () => ({}),
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import { AppBottomBar, type AppTabId } from "@/components/AppBottomBar/AppBottomBar";
import { Shell } from "@/router/AppRouter";

function renderBar(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

function renderTabs(activeTab: AppTabId, unreadCount = 0): string {
  return renderBar(
    <AppBottomBar
      activeTab={activeTab}
      onSelect={() => {}}
      unreadCount={unreadCount}
    />,
  );
}

function renderShell(url: string): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <AppRoot platform="base">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<div>Главная раздела</div>} />
              <Route path="/trips" element={<div>Список поездок</div>} />
              <Route
                path="/trips/my/new"
                element={<div>Создание поездки</div>}
              />
              <Route path="*" element={<div>Фолбэк раздела</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

describe("AppBottomBar", () => {
  it("шесть табов в нативной панели, без кастомного tablist", () => {
    const html = renderTabs("home");
    expect(html).toContain("Главная");
    expect(html).toContain("Поездки");
    expect(html).toContain("Уведомления");
    expect(html).toContain("Профиль");
    expect(html).toContain("Поиск");
    expect(html).toContain("Витрина");
    expect(html).not.toContain('role="tablist"');
  });

  it("бейдж непрочитанных только при unreadCount > 0", () => {
    expect(renderTabs("home")).not.toContain("непрочитанных");
    expect(renderTabs("home", 3)).toContain("непрочитанных: 3");
  });
});

describe("Shell: табы на всех маршрутах", () => {
  it("корень показывает табы в nav «Основные разделы»", () => {
    const html = renderShell("/");
    expect(html).toContain("Основные разделы");
    expect(html).toContain("Главная");
    expect(html).toContain("Поиск");
    expect(html).toContain("<nav");
  });

  it("/trips показывает табы с выбранным поиском", () => {
    const html = renderShell("/trips");
    expect(html).toContain("Основные разделы");
    expect(html).toContain("Список поездок");
    expect(html).toContain('aria-label="Поиск"');
  });

  it("/trips/my/new тоже показывает табы: CTA «Опубликовать» — инлайн в форме", () => {
    const html = renderShell("/trips/my/new");
    expect(html).toContain("Создание поездки");
    expect(html).toContain("Основные разделы");
    expect(html).not.toContain('role="tablist"');
  });
});
