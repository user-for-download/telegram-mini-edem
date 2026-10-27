// Route-шторка деталей поездки: ФОН — экран, откуда пришли.
//
// Раньше `/trips/:tripId` всегда рисовал фоном «Поиск». Тап по уведомлению
// выглядел так: сначала на долю секунды появлялся «Поиск» с подсвеченной
// чужой вкладкой, и только потом выезжали детали. Навигация внутри
// приложения теперь кладёт в state `backgroundLocation` (useOpenTrip), и
// роутер рисует по этому адресу прежний экран, а шторку — поверх него.
//
// Тест интеграционный по роутеру, но страницы-участники замоканы: проверяем
// именно выбор фона и подсветку таба, а не содержимое экранов.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, type InitialEntry } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

// tma-sdk вне Telegram: backButton бросает при прямом вызове, launchParams
// пустые (тот же приём, что в остальных DOM-тестах роутера).
vi.mock("@tma.js/sdk-react", () => ({
  useLaunchParams: () => ({}),
  backButton: {
    onClick: { ifAvailable: () => {} },
    offClick: { ifAvailable: () => {} },
    show: { ifAvailable: () => {} },
    hide: { ifAvailable: () => {} },
  },
}));

vi.mock("@/hooks/useSettingsButton", () => ({
  useSettingsButton: () => {},
}));

vi.mock("@/queries/useNotificationsQuery", () => ({
  useUnreadCountQuery: () => ({ data: 0 }),
}));

// Провайдер шторки чужого профиля тянет react-query; здесь он не нужен —
// проверяем выбор фона, а не шторку профиля.
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  UserProfileProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/pages/Notifications/NotificationsPage", () => ({
  NotificationsPage: () => <div data-testid="notifications-page" />,
}));

vi.mock("@/components/Trip/TripDetailsModal", () => ({
  TripDetailsRoute: () => <div data-testid="trip-deeplink" />,
  TripDetailsSheet: () => <div data-testid="trip-sheet" />,
}));

import { RoutesWithBackground } from "@/router/AppRouter";

afterEach(cleanup);

/** Локация-фон в том виде, в каком её кладёт useOpenTrip. */
function renderAt(entry: InitialEntry) {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[entry]}>
        <RoutesWithBackground />
      </MemoryRouter>
    </AppRoot>,
  );
}

function background(pathname: string, search = "") {
  return { pathname, search, hash: "", state: null, key: "bg" };
}

describe("route-шторка деталей поездки: фон — откуда пришли", () => {
  it("из уведомлений: под шторкой остаются уведомления, а не поиск", () => {
    renderAt({
      pathname: "/trips/t-1",
      state: { backgroundLocation: background("/notifications") },
    });

    expect(screen.getByTestId("notifications-page")).toBeTruthy();
    expect(screen.getByTestId("trip-sheet")).toBeTruthy();
    // «Поиск» — прежний жёсткий фон — не должен появиться вовсе.
    expect(screen.queryByTestId("trip-deeplink")).toBeNull();
  });

  it("вкладка остаётся той, откуда открыли", () => {
    renderAt({
      pathname: "/trips/t-1",
      state: { backgroundLocation: background("/notifications") },
    });

    // Активный таб помечен `aria-current="page"`. Раньше адрес /trips/:id
    // давал подсвеченный «Поиск» — «перекинуло на другую вкладку».
    const active = screen
      .getAllByRole("button")
      .filter((tab) => tab.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("События");
    expect(active[0]?.getAttribute("aria-label")).toContain("уведомления");
  });

  it("холодный deep link без state: фоном «Поиск» (прежний путь)", () => {
    renderAt("/trips/t-1");

    expect(screen.getByTestId("trip-deeplink")).toBeTruthy();
    expect(screen.queryByTestId("notifications-page")).toBeNull();
  });
});

// Заголовок шапки на холодном входе = имя ТОГО экрана, который открылся
// (реестр #52: «имя экрана совпадает со строкой, которая его открывает»).
// Карта `HEADER_TITLE_RULES` — модульная константа и не экспортирована,
// поэтому пин читает исходник: правило и текст шторки обязаны совпадать,
// иначе на deep-link из уведомления шапка называет третье (реестр #56).
describe("заголовок шапки называет открытую шторку, а не алиас", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const routerSrc = readFileSync(join(here, "..", "AppRouter.tsx"), "utf8");
  const rulesStart = routerSrc.indexOf("HEADER_TITLE_RULES");
  const rules = routerSrc.slice(
    rulesStart,
    routerSrc.indexOf("];", rulesStart),
  );
  // Без комментариев: объяснение дефекта само называет прежнее написание.
  const code = rules.replace(/^[ \t]*\/\/.*$/gm, "");

  const pairs: Array<{ rule: string; modalFile: string; title: string }> = [
    {
      rule: "requests",
      modalFile: "components/Trip/TripRequestsModal.tsx",
      title: "Заявки пассажиров",
    },
    {
      rule: "/profile/edit",
      modalFile: "components/Profile/EditProfileModal.tsx",
      title: "Редактировать профиль",
    },
  ];

  for (const { rule, modalFile, title } of pairs) {
    it(`${rule} → «${title}», как в шторке`, () => {
      const line = code.split("\n").find((row) => row.includes(rule));
      expect(line).toBeTruthy();
      expect(line).toContain(`"${title}"`);
      const modal = readFileSync(join(here, "..", "..", modalFile), "utf8");
      expect(modal).toContain(`title="${title}"`);
    });
  }

  it("«Редактирование профиля» — третьего написания одного экрана нет", () => {
    expect(code).not.toContain("Редактирование профиля");
  });
});
