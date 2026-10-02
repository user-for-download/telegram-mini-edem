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
import {
  Button as TguiButton,
  Chip as TguiChip,
  IconButton as TguiIconButton,
  List as TguiList,
  Section as TguiSection,
} from "@telegram-apps/telegram-ui";
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

describe("фасад: variant указывает на ИМЕННО тот режим кита, что задокументирован", () => {
  // Реестр отклонений #6/#7. Матрица выше ловит только «режим существует»,
  // поэтому замена secondary: bezeled → gray (оба валидны у кита) проходила
  // молча. Здесь сверяем наш вариант с НАСТОЯЩИМ рендером кита в ожидаемом
  // mode — без хэшей в тесте, значит переживает rehash кита.
  const cases: { name: string; expectedMode: string; ours: ReactNode; kit: ReactNode }[] = [
    {
      name: "Button.primary",
      expectedMode: "filled",
      ours: <Button variant="primary">ок</Button>,
      kit: <TguiButton mode="filled">ок</TguiButton>,
    },
    {
      name: "Button.secondary",
      expectedMode: "bezeled",
      ours: <Button variant="secondary">ок</Button>,
      kit: <TguiButton mode="bezeled">ок</TguiButton>,
    },
    {
      name: "Button.ghost",
      expectedMode: "plain",
      ours: <Button variant="ghost">ок</Button>,
      kit: <TguiButton mode="plain">ок</TguiButton>,
    },
    {
      name: "Button.outline",
      expectedMode: "outline",
      ours: <Button variant="outline">ок</Button>,
      kit: <TguiButton mode="outline">ок</TguiButton>,
    },
    {
      name: "Button.white",
      expectedMode: "white",
      ours: <Button variant="white">ок</Button>,
      kit: <TguiButton mode="white">ок</TguiButton>,
    },
    {
      name: "IconButton.secondary",
      expectedMode: "bezeled",
      ours: <IconButton variant="secondary" aria-label="д" />,
      kit: <TguiIconButton mode="bezeled" aria-label="д" />,
    },
    {
      name: "IconButton.ghost",
      expectedMode: "plain",
      ours: <IconButton variant="ghost" aria-label="д" />,
      kit: <TguiIconButton mode="plain" aria-label="д" />,
    },
    {
      name: "Chip.quiet",
      expectedMode: "mono",
      ours: <Chip variant="quiet">тег</Chip>,
      kit: <TguiChip mode="mono">тег</TguiChip>,
    },
    {
      name: "Chip.active",
      expectedMode: "elevated",
      ours: <Chip variant="active">тег</Chip>,
      kit: <TguiChip mode="elevated">тег</TguiChip>,
    },
  ];

  for (const { name, expectedMode, ours, kit } of cases) {
    it(`${name} = mode «${expectedMode}» кита`, () => {
      const ourClasses = kitClasses(renderInApp(ours));
      const kitClassesExpected = kitClasses(renderInApp(kit));
      // Наш вариант = кит в ожидаемом режиме, класс в класс.
      expect([...ourClasses].sort()).toEqual([...kitClassesExpected].sort());
    });
  }
});

describe("фасад: обе платформы (iOS-ветка не забыта)", () => {
  // Все замеры выше сняты на platform="base" — а это платформа, где
  // НАШИ переопределения no-op: кит не добавляет ни паддинг List, ни
  // заголовки Modal/FormInput. Живая iOS-ветка проверяется здесь.
  it("кит вешает iOS-паддинг List только на iOS — его и гасит ui/Page", () => {
    const IOS_LIST_CLASS = "tgui-cfed40fe81d34ad5";
    // Класс закреплён выше ("padding:10px 18px"); здесь проверяем, что кит
    // реально вешает его по ветке platform==='ios'.
    const onIos = kitClasses(renderInApp(<TguiList>x</TguiList>, "ios"));
    const onBase = kitClasses(renderInApp(<TguiList>x</TguiList>, "base"));
    expect(onIos.has(IOS_LIST_CLASS)).toBe(true);
    expect(onBase.has(IOS_LIST_CLASS)).toBe(false);
  });

  it("на iOS карточка и чип рендерятся с нашими классами поверх китовых", () => {
    const html = renderInApp(
      <>
        <Card>тело</Card>
        <Chip variant="quiet">тег</Chip>
      </>,
      "ios",
    );
    expect(html).toContain("<article");
    expect(kitClasses(html).size).toBeGreaterThan(0);
    // Наш хэшированный класс присутствует — фасад не «исчез» на iOS.
    expect(html).toContain(uiStyles.cardDefault);
  });

  // Sheet сюда НЕ добавляем: Modal кита рендерится через портал, поэтому в
  // renderToString его содержимого нет физически (проверено: 41 байт на base).
  // Имя диалога на обеих платформах покрыто в ui/__tests__/sheet.test.tsx
  // (jsdom, портал работает) и sheet.ios.test.tsx.
});

describe("фасад Section: заголовок секции повторяет китовые значения", () => {
  // Реестр #15. Фасад обходит китовый SectionHeader узлом, а значит теряет
  // его обёртку <header> с паддингом и цветом — и обязан вернуть их сам.
  // Эти значения сняты из styles.css кита 2.1.13; если придёт bump — падение
  // здесь означает «перепроверь реестр #15 и калибровки в ui/Section.module.css».
  const KIT_HEADER_CLASS = "tgui-d0251b46536ac046";
  const KIT_HEADER_IOS_CLASS = "tgui-b7217abb24e8763a";
  const KIT_CSS = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "node_modules", "@telegram-apps", "telegram-ui", "dist", "styles.css");

  it("кит вешает на заголовок секции свой паддинг (base и iOS разные)", () => {
    const css = readFileSync(KIT_CSS, "utf8");
    expect(css).toContain(`.${KIT_HEADER_CLASS}{`);
    expect(css).toMatch(/padding:20px 24px 4px 22px/);
    expect(css).toContain(`.${KIT_HEADER_IOS_CLASS}{`);
    expect(css).toMatch(/padding:16px 16px 8px/);
  });

  it("наш ui/Section повторяет именно эти значения", () => {
    // ui/Section.module.css — наш источник истины, а не китовский класс:
    // хэш-классы кита меняются от версии к версии, значения — контракт.
    const ours = readFileSync(
      join(dirname(new URL(import.meta.url).pathname), "..", "ui", "Section.module.css"),
      "utf8",
    );
    expect(ours).toMatch(/padding: 20px 24px 4px 22px/);
    expect(ours).toMatch(/padding: 16px 16px 8px/);
    expect(ours).toContain("var(--tgui--link_color)");
    expect(ours).toContain("var(--tgui--section_header_text_color)");
  });

  it("кит действительно зашивает h1 в SectionHeader — иначе фасад не нужен", () => {
    // Контракт, ради которого всё затевалось: строковый header кита = h1.
    const onBase = renderInApp(
      <TguiSection header="Заголовок">тело</TguiSection>,
      "base",
    );
    expect(onBase).toContain("<h1");
  });
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
