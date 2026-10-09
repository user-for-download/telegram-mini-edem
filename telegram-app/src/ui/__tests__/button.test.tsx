// Тесты Button (TGUI-native): data-tap-target="44" для m/l (тап-таргет 44px,
// WCAG 2.5.5), size="s" — компактный, без навязанного min-h. SSR renderToString,
// паттерн ui/__tests__/notice.test.tsx.
//
// Здесь же пин на hover неактивной кнопки: кит рисует подсветку ОТДЕЛЬНЫМ
// псевдоэлементом, и его `[disabled]` её не гасит.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Button } from "@/ui/Button";
import type { ComponentProps } from "react";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@telegram-apps/telegram-ui/package.json");
const kitCss = readFileSync(join(dirname(pkgPath), "dist/styles.css"), "utf8");
const resetCss = readFileSync(
  fileURLToPath(new URL("../buttonReset.module.css", import.meta.url)),
  "utf8",
);

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

describe("Button: неактивная кнопка не реагирует на наведение", () => {
  it("кит рисует hover псевдоэлементом — это подтверждает диагноз", () => {
    // Подсветка при наведении живёт в `:hover:after`, а не на самой кнопке,
    // поэтому гасить её надо pseudoselector-ом. Если кит перепишет hover на
    // сам элемент, наш пины below начнут врать — и это будет повод пересмотреть
    // правило (оно при этом станет безвредным no-op).
    expect(kitCss).toMatch(/:hover:after\{opacity:var\(--tgui--button--hovered-opacity\)\}/);
  });

  it("кит гасит курсор, но НЕ подсветку при disabled", () => {
    // Именно это и наблюдал водитель: курсор у кит-disabled правильный
    // (default), а подсветка на :hover остаётся и «зажигает» кнопку.
    const disabled = kitCss.match(/\.tgui-[\w-]+\[disabled\]\{[^}]*\}/)?.[0] ?? "";
    expect(disabled).toContain("cursor:default");
    expect(disabled).not.toContain(":hover");
  });

  it("наше правило снимает оверлей у disabled — и не трогает активные кнопки", () => {
    expect(resetCss).toMatch(/button:disabled::after\s*\{[^}]*opacity:\s*0/);
    // Селектор именно по disabled: хэш-классы кита меняются при bump версии,
    // `disabled` — нет. Правило без `!important` (наш слой неслойный).
    expect(resetCss).not.toMatch(/button:disabled::after\s*\{[^}]*!/);
    expect(resetCss).not.toMatch(/^\s*button::after/m);
  });
});
