// @vitest-environment jsdom
// A11y-контракт шторки: имя диалога связано через aria-labelledby
// и фокус при открытии переезжает в тело (точка входа для клавиатуры
// и скринридера). DOM-тест: Modal — портал, в SSR его не видно.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Sheet } from "../Sheet";

// usePlatform читает внутренний контекст кита; в vitest deep-импорт
// useAppRootContext даёт вторую копию модуля — мокаем платформу.
// iOS-ветка — в sheet.ios.test.tsx.
vi.mock("@/hooks/usePlatform", () => ({ usePlatform: () => "base" }));

function show(title = "Настройки") {
  render(
    <AppRoot>
      <Sheet open onClose={() => {}} title={title}>
        <button type="button">Действие</button>
      </Sheet>
    </AppRoot>,
  );
}

// Обязателен: vitest здесь без globals, поэтому авто-cleanup RTL не включается.
// Modal — портал на Radix-примитивах, и неразмонтированная шторка держит на
// document focusin-ловушку (FocusScope) и снятый с body pointer-events.
// Шторка первого теста оставалась живой и перехватывала фокус в СВОЙ диалог:
// второй тест проверял activeElement чужого дерева и проходил только потому,
// что обе шторки одинаковые.
afterEach(cleanup);

describe("Sheet", () => {
  it("имя диалога доходит до aria-labelledby", () => {
    show();
    const dialog = screen.getByRole("dialog", { name: "Настройки" });
    const labelledby = dialog.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby!)?.textContent).toBe(
      "Настройки",
    );
  });

  it("фокус при открытии переезжает в тело шторки", () => {
    show();
    const active = document.activeElement as HTMLElement | null;
    expect(active?.tagName).toBe("DIV");
    expect(active?.tabIndex).toBe(-1);
    expect(active?.textContent).toContain("Действие");
  });
});
