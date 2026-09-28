// Контракт с telegram-ui: замеры кита, на которые опираются комментарии
// src/ui/* и «Реестр отклонений» (src/ui/README.md). Тест падает при bump'е
// версии кита — тогда перепроверить реестр, обновить калибровки в коде и
// значения здесь. Смысл: знание о внутренностях кита (хэш-классы, высоты,
// паддинги) не должно гнить молча.
//
// SSR renderToString, паттерн ui/__tests__/button.test.tsx.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";

import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import uiStyles from "@/ui/ui.module.css";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@telegram-apps/telegram-ui/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
const kitCss = readFileSync(join(dirname(pkgPath), "dist/styles.css"), "utf8");

/** Версия, по которой калиброваны замеры ниже. */
const KIT_VERSION = "2.1.13";

function kitClasses(html: string): Set<string> {
  return new Set([...html.matchAll(/tgui-[a-z0-9]+/g)].map((m) => m[0]));
}

function renderInApp(node: ReactNode, platform: "base" | "ios" = "base"): string {
  return renderToString(<AppRoot platform={platform}>{node}</AppRoot>);
}

describe("контракт с telegram-ui", () => {
  it(`версия кита — ${KIT_VERSION} (по ней калиброваны замеры ниже)`, () => {
    expect(pkg.version).toBe(KIT_VERSION);
  });

  it("List: ритм 12px и iOS-паддинг 10px/18px (источник отклонений #1/#2)", () => {
    // .page пинит ритм своим токеном, а .pageHero гасит iOS-паддинг.
    expect(kitCss).toContain(
      ".tgui-389a43acd684137a>:not(:last-child){margin-bottom:12px}",
    );
    expect(kitCss).toContain(
      ".tgui-cfed40fe81d34ad5{box-sizing:border-box;padding:10px 18px}",
    );
  });

  it("Card: inline-block + фон tertiary (источник отклонений #3/#4)", () => {
    const rule = kitCss.match(/\.tgui-dbf261f4b3046bb3\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("display:inline-block");
    expect(rule).toContain("border-radius:20px");
    expect(rule).toContain("--tgui--tertiary_bg_color");
  });

  it("Button: высоты s/m/l (источник отклонения #5)", () => {
    expect(kitCss).toContain(".tgui-13f23a224303ddaa{border-radius:20px;gap:6px;height:36px");
    expect(kitCss).toContain(".tgui-1a16a49d89076ff4{gap:8px;height:42px");
    expect(kitCss).toContain(".tgui-9cef742a22f195c9{gap:10px;height:50px");
  });
});

describe("фасад: смысловые variant указывают на реальные режимы кита", () => {
  const matrix: { name: string; variants: Record<string, ReactNode> }[] = [
    {
      name: "Button",
      variants: {
        primary: <Button variant="primary">ок</Button>,
        secondary: <Button variant="secondary">ок</Button>,
        ghost: <Button variant="ghost">ок</Button>,
        outline: <Button variant="outline">ок</Button>,
        white: <Button variant="white">ок</Button>,
      },
    },
    {
      name: "IconButton",
      variants: {
        secondary: <IconButton variant="secondary" aria-label="д" />,
        ghost: <IconButton variant="ghost" aria-label="д" />,
        muted: <IconButton variant="muted" aria-label="д" />,
      },
    },
    {
      name: "Chip",
      variants: {
        quiet: <Chip variant="quiet">тег</Chip>,
        active: <Chip variant="active">тег</Chip>,
      },
    },
  ];

  for (const { name, variants } of matrix) {
    it(`${name}: каждый вариант — свой режим кита, чужих классов нет`, () => {
      const entries = Object.entries(variants);
      const sets = entries.map(([variant, node]) => {
        const classes = kitClasses(renderInApp(node));
        expect(classes.size, `${name}.${variant} не отрендерил классы кита`).toBeGreaterThan(0);
        return classes;
      });

      // Попарно разные наборы = variant реально переключает mode кита.
      const signatures = sets.map((s) => [...s].sort().join(" "));
      expect(new Set(signatures).size, `${name}: варианты не различимы`).toBe(entries.length);

      // Классы, отличающие варианты, — это и есть mode-классы кита: каждый
      // обязан быть в stylesheet кита (иначе мэппинг variant → mode протух).
      // Общие классы (AppRoot/Tappable/размеры) не проверяем: часть из них
      // кит отдаёт в JS, но правил в styles.css не публикует — известный
      // пробел кита, не наш (см. отчёт по ui/).
      const shared = sets.reduce(
        (acc, s) => new Set([...acc].filter((cls) => s.has(cls))),
        sets[0] as Set<string>,
      );
      const modeClasses = new Set(
        sets.flatMap((s) => [...s].filter((cls) => !shared.has(cls))),
      );
      expect(modeClasses.size).toBeGreaterThanOrEqual(entries.length);
      const missing = [...modeClasses].filter((cls) => !kitCss.includes(`.${cls}`));
      expect(missing, `${name}: mode-классов нет в stylesheet кита`).toEqual([]);
    });
  }
});

describe("фасад Card: нативный article + бокс приложения", () => {
  it("рендерит article кита с нашим вариантом поверхности", () => {
    const html = renderInApp(<Card>тело</Card>);
    expect(html).toContain("<article");
    expect(kitClasses(html).size).toBeGreaterThan(0);
    expect(html).toContain(uiStyles.cardDefault);

    const flush = renderInApp(<Card variant="flush">тело</Card>);
    expect(flush).toContain(uiStyles.cardFlush);
    expect(flush).not.toContain(uiStyles.cardDefault);
  });

  it("Card.Cell и Card.Chip ре-экспортированы (обход кита не нужен)", () => {
    expect(typeof Card.Cell).toBe("function");
    expect(typeof Card.Chip).toBe("function");
  });
});
