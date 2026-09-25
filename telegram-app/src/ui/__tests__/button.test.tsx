// Тесты Button (TGUI-native): data-tap-target="44" для m/l (тап-таргет 44px,
// WCAG 2.5.8), size="s" — компактный, без навязанного min-h. SSR renderToString,
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
  it("default (m) держит tap-target 44", () => {
    expect(renderButton({ children: "Ок" })).toContain('data-tap-target="44"');
  });

  it('size="l" держит tap-target 44', () => {
    expect(renderButton({ children: "Ок", size: "l" })).toContain(
      'data-tap-target="44"',
    );
  });

  it('size="s" без tap-target (компактный контекст)', () => {
    expect(renderButton({ children: "Ок", size: "s" })).not.toContain(
      "data-tap-target",
    );
  });

  it("явный className сохраняется рядом с tap-target", () => {
    const html = renderButton({ children: "Ок", className: "foo" });
    expect(html).toContain('data-tap-target="44"');
    expect(html).toContain("foo");
  });
});
