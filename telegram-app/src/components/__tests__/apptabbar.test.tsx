// Рендер-тесты нижнего бара: 5 разделов в нативном Tabbar,
// активный таб — selected-класс tgui ровно один раз, бейдж непрочитанных.
// Нативный Tabbar.Item не несёт tab-семантики (без tablist/aria-selected),
// счётчик для скринридера дублируется в aria-label кнопки.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import { AppBottomBar, type AppTabId } from "@/components/AppBottomBar/AppBottomBar";

function render(activeTab: AppTabId, unreadCount = 0): string {
  return renderToString(
    <AppRoot platform="base">
      <AppBottomBar activeTab={activeTab} onSelect={() => {}} unreadCount={unreadCount} />
    </AppRoot>,
  );
}

describe("AppBottomBar", () => {
  it("пять разделов с подписями в нативном Tabbar", () => {
    const html = render("home");
    expect(html).toContain("Главная");
    expect(html).toContain("Поездки");
    expect(html).toContain("Уведомления");
    expect(html).toContain("Поиск");
    expect(html).toContain("Профиль");
    // Кастомной пилюли/tablist больше нет — семантика нативная.
    expect(html).not.toContain('role="tablist"');
  });

  it("порядок: Главная → Поездки → Поиск → Уведомления → Профиль (нативный ряд)", () => {
    const html = render("home");
    const order = ["Главная", "Поездки", "Поиск", "Уведомления", "Профиль"].map((t) =>
      html.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("shadow");
  });

  it("активный таб выделен selected-классом ровно один раз", () => {
    const html = render("notifications");
    // tgui Tabbar.Item: selected && "tgui-e6658d0b8927f95e" (pinned v2.1.13).
    expect(html.match(/tgui-e6658d0b8927f95e/g)?.length).toBe(1);
    expect(html).toContain("Уведомления");
  });

  it("бейдж непрочитанных только при count > 0", () => {
    expect(render("home")).not.toContain("непрочитанных");
    const html = render("home", 3);
    expect(html).toContain("непрочитанных: 3");
    expect(render("home", 150)).toContain("99+");
  });
});
