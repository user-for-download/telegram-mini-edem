// Тесты Button (K4): min-h-11 для m/l (тап-таргет 44px, WCAG 2.5.8),
// size="s" — компактный, без навязанного min-h. SSR renderToString,
// паттерн ui/__tests__/notice.test.tsx.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { Button } from "@/ui/Button";
import type { ComponentProps } from "react";

function renderButton(props: ComponentProps<typeof Button>): string {
  return renderToString(
    <AppRoot platform="base">
      <Button {...props} />
    </AppRoot>,
  );
}

describe("Button", () => {
  it("default (m) держит min-h-11", () => {
    expect(renderButton({ children: "Ок" })).toContain("min-h-11");
  });

  it('size="l" держит min-h-11', () => {
    expect(renderButton({ children: "Ок", size: "l" })).toContain("min-h-11");
  });

  it('size="s" без min-h-11 (компактный контекст)', () => {
    expect(renderButton({ children: "Ок", size: "s" })).not.toContain(
      "min-h-11",
    );
  });

  it("явный className сохраняется рядом с min-h", () => {
    const html = renderButton({ children: "Ок", className: "foo" });
    expect(html).toContain("min-h-11");
    expect(html).toContain("foo");
  });
});
