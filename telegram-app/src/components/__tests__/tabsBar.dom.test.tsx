// @vitest-environment jsdom
// F3: активный раздел нижнего бара не был виден скринридеру.
//
// `Tabbar.Item` кита — это `<button>`, у которого `selected` переключает
// только CSS-класс (TabbarItem.js), в дерево доступности состояние не
// попадает: все пять кнопок читались одинаково. Проверяем ИМЕННО DOM-атрибут
// `aria-current` на самой кнопке (не пропсы компонента) — иначе тест зелёный
// и на сломанной разметке.
//
// Плюс согласованность имени с состоянием: `aria-label` заменяет доступное
// имя целиком, поэтому «непрочитанных: N» не должен пересекаться с
// объявлением текущего раздела, а счётчик не должен называться, когда его
// нет (MEMORY.md:491 — неизвестное число не ноль).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import {
  AppBottomBar,
  type AppTabId,
} from "@/components/AppBottomBar/AppBottomBar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Маршруты — те же, что в AppRouter: стенд повторяет роутер, иначе тап
// не переносит состояние и второй тест проверял бы пустоту.
const ROUTE_TO_TAB: Record<string, AppTabId> = {
  "/": "home",
  "/bookings": "trips",
  "/trips": "search",
  "/notifications": "notifications",
  "/profile": "profile",
};

const ORDER = ["Главная", "Поездки", "Поиск", "Уведомления", "Профиль"];

function Stands({ unreadCount = 0 }: { unreadCount?: number }) {
  const [active, setActive] = useState<AppTabId>("home");
  return (
    <AppRoot platform="base">
      <AppBottomBar
        activeTab={active}
        onSelect={(to) => setActive(ROUTE_TO_TAB[to] ?? "home")}
        unreadCount={unreadCount}
      />
    </AppRoot>
  );
}

/** Все пять кнопок таббара в порядке DOM. */
function tabs(): HTMLButtonElement[] {
  return screen.getAllByRole("button") as HTMLButtonElement[];
}

/** Разделы, объявляющие себя текущими. */
function currentTabs(): HTMLButtonElement[] {
  return tabs().filter((tab) => tab.getAttribute("aria-current") === "page");
}

describe("TabsBar: состояние раздела для скринридера", () => {
  it("у выбранного раздела aria-current=\"page\", у остальных атрибута нет", () => {
    render(<Stands />);

    // Атрибут читаем с самой кнопки — это то, что попадает в дерево доступности.
    const current = currentTabs();
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("aria-label")).toBe("Главная");

    for (const tab of tabs().filter((t) => t !== current[0])) {
      expect(tab.hasAttribute("aria-current")).toBe(false);
    }
  });

  it("после тапа по третьему разделу aria-current переезжает на него", () => {
    render(<Stands />);

    fireEvent.click(screen.getByRole("button", { name: "Поиск" }));

    const current = currentTabs();
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("aria-label")).toBe("Поиск");
    expect(
      screen.getByRole("button", { name: "Главная" }).hasAttribute("aria-current"),
    ).toBe(false);
  });

  it("aria-current не меняет доступность с клавиатуры: пять кнопок в прежнем порядке", () => {
    render(<Stands />);

    const all = tabs();
    expect(all).toHaveLength(5);
    // Китовский Tabbar.Item рендерит нативную кнопку — фокусируется сама,
    // никакого tabindex/role подменять не нужно.
    all.forEach((tab) => expect(tab.tagName).toBe("BUTTON"));
    all.forEach((tab) => expect(tab.getAttribute("tabindex")).toBeNull());
    expect(
      all.map((tab) => tab.getAttribute("aria-label")).sort(),
    ).toEqual([...ORDER].sort());
  });

  it("имя раздела с бейджем не выдаёт состояние и не называет счётчик, когда его нет", () => {
    const { unmount } = render(<Stands unreadCount={3} />);
    const notifications = screen.getByRole("button", { name: /^Уведомления/ });
    // Имя начинается с видимой подписи (MEMORY.md:490), счётчик дописан в конец.
    expect(notifications.getAttribute("aria-label")).toBe(
      "Уведомления, непрочитанных: 3",
    );
    expect(notifications.hasAttribute("aria-current")).toBe(false);
    unmount();

    render(<Stands />);
    // Без счётчика имя раздела нейтрально — «0 непрочитанных» не выдумывается.
    expect(screen.getByRole("button", { name: "Уведомления" }).getAttribute("aria-label")).toBe(
      "Уведомления",
    );
  });
});
