// @vitest-environment jsdom
// iOS-ветка шторки: видимый заголовок берёт Modal.Header, дублирующий
// Headline не рендерится, имя диалога — то же. Мок платформы — см.
// комментарий в sheet.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Sheet } from "../Sheet";

vi.mock("@/hooks/usePlatform", () => ({ usePlatform: () => "ios" }));

describe("Sheet iOS", () => {
  it("имя диалога связано, видимого дубля заголовка нет", () => {
    render(
      <AppRoot>
        <Sheet open onClose={() => {}} title="Настройки">
          <button type="button">Действие</button>
        </Sheet>
      </AppRoot>,
    );
    const dialog = screen.getByRole("dialog", { name: "Настройки" });
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    // Видимых копий заголовка для скринридера нет — только скрытый h2.
    const headings = screen.getAllByRole("heading", { name: "Настройки" });
    expect(headings).toHaveLength(1);
    expect(headings.at(0)?.tagName).toBe("H2");
  });
});
