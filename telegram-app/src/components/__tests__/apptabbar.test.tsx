// Рендер-тесты нижнего бара: 5 кнопок (пилюла из 4 + Поиск отдельно),
// активный таб подсвечен (aria-current + aria-selected), бейдж непрочитанных.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import { AppTabbar, type AppTabId } from "@/components/AppTabbar";

function render(activeTab: AppTabId, unreadCount = 0): string {
  return renderToString(
    <AppRoot platform="base">
      <AppTabbar activeTab={activeTab} onSelect={() => {}} unreadCount={unreadCount} />
    </AppRoot>,
  );
}

describe("AppTabbar", () => {
  it("пять разделов с подписями", () => {
    const html = render("home");
    expect(html).toContain("Главная");
    expect(html).toContain("Поездки");
    expect(html).toContain("Уведомления");
    expect(html).toContain("Поиск");
    expect(html).toContain("Профиль");
    expect(html).toContain('role="tablist"');
  });

  it("порядок: Главная → Поездки → Уведомления → Профиль, Поиск отдельно", () => {
    const html = render("home");
    const order = ["Главная", "Поездки", "Уведомления", "Профиль", "Поиск"].map((t) =>
      html.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("shadow");
  });

  it("активный таб помечен aria-current/selected", () => {
    const html = render("notifications");
    expect(html).toContain('aria-current="page"');
    // Выбран ровно один таб.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain("Уведомления");
  });

  it("бейдж непрочитанных только при count > 0", () => {
    expect(render("home")).not.toContain("непрочитанных");
    const html = render("home", 3);
    expect(html).toContain("непрочитанных: 3");
    expect(render("home", 150)).toContain("99+");
  });
});
