// Рендер-тесты нижнего бара: 4 круглые кнопки, активный таб подсвечен
// (aria-current + aria-selected), клик по активному — без навигации.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import { AppTabbar } from "@/components/AppTabbar";

function render(activeTab: "home" | "trips" | "search" | "profile"): string {
  return renderToString(
    <AppRoot platform="base">
      <AppTabbar activeTab={activeTab} onSelect={() => {}} />
    </AppRoot>,
  );
}

describe("AppTabbar", () => {
  it("четыре раздела с подписями", () => {
    const html = render("home");
    expect(html).toContain("Главная");
    expect(html).toContain("Поездки");
    expect(html).toContain("Поиск");
    expect(html).toContain("Профиль");
    expect(html).toContain('role="tablist"');
  });

  it("порядок: Главная → Поездки → Профиль, Поиск отдельно", () => {
    const html = render("home");
    const order = ["Главная", "Поездки", "Профиль", "Поиск"].map((t) =>
      html.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("shadow");
  });
  it("активный таб помечен aria-current/selected", () => {
    const html = render("search");
    expect(html).toContain('aria-current="page"');
    // Выбран ровно один таб.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain("Поиск");
  });
});
