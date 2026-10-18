// Визуальный контракт экрана поиска (SearchPage).
//
// До 2026-10-18 экран был собран как «страница в странице»:
//  1. заголовок секции «Поиск попутных поездок» дословно повторял название
//     вкладки и жил синим h1 — при том что имя экрана обязано быть у
//     страницы (реестр #15/#23);
//  2. фильтр был полноэкранной Section без радиуса, поэтому три разных
//     вертикали в одном блоке: заголовок на 22px, тело на 16px, поля кита
//     ещё на 22px внутри контрола;
//  3. четыре сегмента даты по содержимому не влезали в 324px и
//     переносились, оставляя «Выходные» одну на второй строке;
//  4. своп городов — 26×26 на отрицательных отступах в зазоре 6px: иконка
//     прижималась к подписи «Куда», тап-таргет меньше пальца;
//  5. «Найти» была secondary, при том что то же действие на главной —
//     primary: одно действие выглядело по-разному на двух экранах.
//
// Пины текстовые: jsdom не каскадит CSS-модули и не считает layout
// (прецедент homeVisual.test.ts). Реальные размеры контролирует
// e2e/ui-cascade.mjs, ui-rhythm.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", "..", relativePath), "utf8");

/** Код без комментариев: пины смотрят на разметку, а не на объяснения. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const pageTsx = code(readSrc("pages/Search/SearchPage.tsx"));
const pageCss = readSrc("pages/Search/SearchPage.module.css");
const switcherTsx = code(readSrc("ui/Switcher.tsx"));
const switcherCss = readSrc("ui/Switcher.module.css");
const resetCss = readSrc("ui/buttonReset.module.css");
const chipCss = readSrc("ui/Chip.module.css");

/** Тело правила, чей селектор стоит отдельной строкой (`sel {`). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ??
    ""
  );
}

describe("поиск: один экран, одна поверхность", () => {
  it("имя экрана — у страницы, а не заголовком секции", () => {
    expect(pageTsx).toMatch(
      /<VisuallyHidden Component="h1">Поиск<\/VisuallyHidden>/,
    );
    // Синяя подпись-дубль названия вкладки убрана вместе с Section.
    expect(pageTsx).not.toContain("Поиск попутных поездок");
    expect(pageTsx).not.toMatch(/<Section\b/);
  });

  it("фильтр — карточка приложения, а не полноэкранная секция", () => {
    expect(pageTsx).toContain("<Card className={styles.searchCard}>");
    expect(ruleBody(pageCss, ".searchCard.searchCard")).toMatch(
      /gap:\s*var\(--app-space-sm\)/,
    );
    // Паддинг/радиус/тень — из ui/Card, своих литералов карточке не нужно.
    expect(ruleBody(pageCss, ".searchCard.searchCard")).not.toMatch(
      /padding:|border-radius:|box-shadow:/,
    );
  });

  it("оба селекта — компактные, как поиск на главной", () => {
    expect(pageTsx.match(/\n\s+compact\n/g) ?? []).toHaveLength(2);
  });

  it("«Найти» — главное действие, как на главной", () => {
    expect(pageTsx).toMatch(/<Button[\s\S]{0,200}?variant="primary"/);
  });
});

describe("поиск: сегменты даты в одну строку", () => {
  it("Switcher умеет stretch и включает равные сегменты", () => {
    expect(switcherTsx).toMatch(/stretch\?: boolean/);
    expect(switcherTsx).toMatch(
      /stretch \? `\$\{styles\.row\} \$\{styles\.stretch\}`/,
    );
    expect(pageTsx).toMatch(/<Switcher[\s\S]{0,400}?stretch/);
    // Перенос строки давал «Выходные» одну на второй строке.
    expect(ruleBody(switcherCss, ".stretch")).toMatch(/flex-wrap:\s*nowrap/);
    expect(ruleBody(switcherCss, ".stretch > *")).toMatch(/flex:\s*1 1 0/);
  });

  it("кегль сегмента — 12px: на 320px иначе не влезают «Выходные»", () => {
    // Ширину сегмента делит контейнер (320px → 62px на пункт), кит режет
    // подпись многоточием — «Выходн…». Проверено в Chromium на 320/360/390.
    expect(ruleBody(switcherCss, ".stretch > * *")).toMatch(
      /font-size:\s*12px/,
    );
    expect(ruleBody(switcherCss, ".stretch > *")).toMatch(/padding-left:\s*0/);
    expect(ruleBody(switcherCss, ".stretch")).toMatch(/gap:\s*2px/);
  });
});

describe("поиск: своп городов — полноценный тап-таргет", () => {
  it("кнопка в своей колонке сетки, а не на отрицательных отступах", () => {
    expect(ruleBody(pageCss, ".cityFields")).toMatch(/display:\s*grid/);
    expect(ruleBody(pageCss, ".cityFields")).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) auto/,
    );
    expect(ruleBody(pageCss, ".swap.swap")).toMatch(/grid-area:/);
    // Прежний приём — 26×26 на минус-отступах — снят.
    expect(pageCss).not.toMatch(/margin:\s*-16px/);
  });

  it("44×44 подключается стабильным классом ICON_TARGET", () => {
    expect(pageTsx).toMatch(/ICON_TARGET/);
  });
});

describe("поиск: сводка выдачи — факт, а не метка формы", () => {
  it("число + склонённое слово, счётчик — серверный total", () => {
    expect(pageTsx).toContain('plural(found, "поездка", "поездки", "поездок")');
    expect(pageTsx).toMatch(/pagination\?\.total \?\? items\.length/);
    expect(pageTsx).not.toContain("Найдено поездок");
  });

  it("«Фильтры» стоят после маршрута и даты и считают только доп. фильтры", () => {
    const cityAt = pageTsx.indexOf("styles.cityFields");
    const dateAt = pageTsx.indexOf("<Switcher");
    const filtersAt = pageTsx.indexOf("styles.chipRow");
    expect(cityAt).toBeGreaterThan(-1);
    expect(dateAt).toBeGreaterThan(cityAt);
    expect(filtersAt).toBeGreaterThan(dateAt);
    // Города и дата видны и без раскрытия панели — их в счётчик не берём.
    expect(ruleBody(pageCss, ".chipRow")).toBeTruthy();
  });
});

describe("ui: сброс кнопки не гасит поверхность чипа", () => {
  // Корень одной ошибки, найденной на этом экране: `AS_BUTTON` содержал
  // `background: transparent`, а наш модуль неслойный — он перебивал
  // китовую плашку. Все невыбранные чипы приложения (теги, «Фильтры»)
  // выглядели простым текстом: не видно, что по ним можно нажать.
  it("поверхность гасит отдельный .flatButton, а не общий сброс", () => {
    expect(ruleBody(resetCss, ".asButton")).not.toMatch(/background:/);
    expect(ruleBody(resetCss, ".flatButton")).toMatch(
      /background:\s*transparent/,
    );
  });

  it("Cell и аккордеон берут FLAT, Chip — общий сброс", () => {
    expect(readSrc("ui/Cell.tsx")).toContain("AS_BUTTON_FLAT");
    expect(readSrc("pages/Support/SupportPage.tsx")).toContain(
      "AS_BUTTON_FLAT",
    );
    expect(readSrc("ui/Chip.tsx")).toMatch(/^\s+AS_BUTTON,$/m);
    expect(readSrc("ui/Chip.tsx")).not.toContain("AS_BUTTON_FLAT");
  });

  it("нажатый чип — плашка --app-info-bg для ЛЮБОГО чипа, не только accent", () => {
    // Кит для elevated даёт --tgui--surface_primary + тень; в тёмной теме
    // surface_primary темнее карточки, и «включено» читалось вдавленным.
    expect(ruleBody(chipCss, '.chip[aria-pressed="true"]')).toMatch(
      /background:\s*var\(--app-info-bg\)/,
    );
    expect(ruleBody(chipCss, '.chip[aria-pressed="true"]')).toMatch(
      /box-shadow:\s*none/,
    );
  });
});
