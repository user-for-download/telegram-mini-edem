import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ShowcasePage } from "@/pages/ShowcasePage/ShowcasePage";

describe("ShowcasePage", () => {
  it("рендерит все 12 пронумерованных секций", () => {
    const html = renderToStaticMarkup(
      <AppRoot>
        <ShowcasePage />
      </AppRoot>,
    );
    for (let n = 1; n <= 12; n++) {
      expect(html).toContain(`${n}.`);
    }
    expect(html).toContain("Типографика");
    expect(html).toContain("Служебное");
  });
});
