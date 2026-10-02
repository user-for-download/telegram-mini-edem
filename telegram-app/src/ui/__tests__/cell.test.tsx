// Контракт фасада ui/Cell — в двух частях.
//
// 1. КИТ. `Component="button"` документирован (Cell.d.ts: «Custom component or
//    HTML tag to be used as the root element of the cell, div by default»), но
//    кит НЕ сбрасывает UA-стили кнопки. Если при bump'е кит начнёт их
//    сбрасывать — наш сброс станет дублирующим (безвредно), и наоборот: если
//    появится новое UA-течение, тест не заметит. Поэтому здесь пиним именно
//    ТЕКУЩЕЕ состояние кита, а «не течёт ли» проверяется в браузере
//    (e2e/ui-cascade.mjs) и в card/cell-тестах по class-атрибуту.
//
// 2. ФАСАД. ui/Cell обязан навесить сброс на оба варианта корня (button и
//    div) — иначе строки будут считаться по-разному (замер: 356 против 404).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot, Cell as TguiCell } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";

import { Cell } from "@/ui/Cell";
import { AS_BUTTON } from "@/ui/classes";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@telegram-apps/telegram-ui/package.json");
const kitCss = readFileSync(join(dirname(pkgPath), "dist/styles.css"), "utf8");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

/** Корневой класс китового Cell. */
const KIT_CELL = "tgui-b8dfba0b5c3d054c";
const KIT_TAPPABLE = "tgui-b5d680db78c4cc2e";

/**
 * CSS-модули типизированы `string | undefined`. Сужаем один раз: если бы
 * класс `.asButton` пропал из buttonReset.module.css, тест обязан упасть
 * здесь, а не сравнивать разметку с `undefined`.
 */
const RESET = ((): string => {
  if (typeof AS_BUTTON !== "string" || AS_BUTTON === "") {
    throw new Error("ui/buttonReset.module.css: класс .asButton отсутствует");
  }
  return AS_BUTTON;
})();

const render = (node: ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

/**
 * Тег КОРНЯ клетки, а не обёртки AppRoot: ищем элемент с китовым
 * классом Cell. Раньше здесь был `html.match(/^<(\w+)/)`, и он всегда
 * возвращал `div` — то есть тест «button-корень» проходил бы, никогда не
 * проверив ничего.
 */
const rootTagOf = (html: string): string => {
  // В шаблонной строке `\w` без экранирования превращается в `w`
  // (неизвестная escape-последовательность), и регулярка ищет литеральные
  // «w» — отсюда был '?' вместо тега. Поэтому здесь `\\w+`.
  const m = new RegExp(`<(\\w+)[^>]*class="[^"]*${KIT_CELL}`).exec(html);
  return m?.[1] ?? "?";
};

describe("кит: Cell/Tappable не сбрасывают UA-стили кнопки", () => {
  it(`версия кита — ${pkg.version}`, () => {
    expect(pkg.version).toBe("2.1.13");
  });

  it("Cell задаёт flex + gap + padding, но НЕ appearance и НЕ box-sizing", () => {
    const rule = kitCss.match(new RegExp(`\\.${KIT_CELL}\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule).toContain("display:flex");
    expect(rule).toContain("gap:24px");
    // Чего в ките нет — то и держит наш сброс. Появление здесь = наш сброс
    // стал дублирующим; его нужно будет пересмотреть, а не молча оставить.
    expect(rule).not.toContain("appearance");
    expect(rule).not.toContain("box-sizing");
  });

  it("Tappable задаёт только cursor/isolation/position — никакого сброса", () => {
    const rule = kitCss.match(new RegExp(`\\.${KIT_TAPPABLE}\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule).toContain("cursor:pointer");
    expect(rule).not.toContain("appearance");
    expect(rule).not.toMatch(/font:/);
  });

  it("в ките вообще нет сброса font/color под <button>", () => {
    // Точечно: ищем правила, которые выглядели бы как наш asButton.
    expect(kitCss).not.toContain("font:inherit");
    expect(kitCss).not.toContain("font-family:inherit");
  });
});

describe("фасад ui/Cell", () => {
  it("класс сброса задан и непустой", () => {
    expect(RESET).toBeTruthy();
  });

  it("сброс навешен и на div-корень (по умолчанию)", () => {
    const html = render(<Cell>строка</Cell>);
    expect(html).toContain(KIT_CELL);
    expect(html).toContain(RESET);
    expect(rootTagOf(html)).toBe("div");
  });

  it("сброс навешен и на button-корень (Component=\"button\")", () => {
    const html = render(
      <Cell Component="button" type="button">
        строка
      </Cell>,
    );
    expect(html).toContain(KIT_CELL);
    expect(html).toContain(RESET);
    expect(rootTagOf(html)).toBe("button");
  });

  it("оба корня несут сброс ровно один раз — иначе появился бы ложный .X.X", () => {
    for (const [name, node] of [
      ["div", <Cell>строка</Cell>],
      [
        "button",
        <Cell Component="button" type="button">
          строка
        </Cell>,
      ],
    ] as [string, ReactNode][]) {
      const count = (render(node).match(new RegExp(RESET, "g")) ?? []).length;
      expect(count, `.${name}: сброс применён ${count} раз(а)`).toBe(1);
    }
  });

  it("className потребителя дописывается, а не затирает сброс", () => {
    const html = render(<Cell className="myRow">строка</Cell>);
    expect(html).toContain(RESET);
    expect(html).toContain("myRow");
  });

  it("контракт кита 1:1: пропсы проходят без изменений", () => {
    const html = render(
      <Cell
        Component="button"
        type="button"
        aria-label="Меню"
        subhead="подзаголовок"
        subtitle="второй"
        description="третий"
        hint="×2"
        multiline
      >
        заголовок
      </Cell>,
    );
    expect(html).toContain('aria-label="Меню"');
    expect(html).toContain("подзаголовок");
    expect(html).toContain("второй");
    expect(html).toContain("третий");
    expect(html).toContain("заголовок");
  });

  it("фасад рендерит ровно то же, что кит, плюс наш класс", () => {
    const ours = render(<Cell>строка</Cell>);
    const kit = render(<TguiCell>строка</TguiCell>);
    // Порядок классов не важен (фасад ставит сброс первым, кит — className
    // последним), поэтому сравниваем МНОЖЕСТВА классов и содержимое.
    const classesOf = (h: string) => {
      const m = h.match(/class="([^"]*)"/);
      return new Set((m?.[1] ?? "").split(/\s+/).filter(Boolean));
    };
    const innerOf = (h: string) => h.replace(/<[^>]*>/g, "").trim();
    const oursNoReset = new Set(
      [...classesOf(ours)].filter((c) => c !== RESET),
    );
    expect(oursNoReset).toEqual(classesOf(kit));
    expect(innerOf(ours)).toBe(innerOf(kit));
  });
});
