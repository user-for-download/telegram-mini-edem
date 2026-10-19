// Визуальный контракт экрана «Поездки» (TripActivePage, /bookings).
//
// До 2026-10-18 (наш проход по оставшимся экранам) здесь было четыре
// расхождения с каноном приложения:
//  1. строка поиска резервировала 84px вместо 48: правило снимало резерв
//     кита ХЕШ-классом кита (`.tgui-8ca5…`, pinned 2.1.13) потомком
//     `.searchField`, а хеш висит на РОДИТЕЛЕ того label, которому наш
//     класс достаётся, — селектор не матчил ничего (замер в Chromium:
//     `padding: 20px 22px 16px`, бокс 84px при пилюле 48);
//  2. «Найти поездку» была secondary, хотя то же действие залито на
//     главной и на поиске (реестр #6);
//  3. «+ Создать поездку» — единственное в приложении действие с плюсом
//     в подписи вместо иконки слотом `before`;
//  4. действие пустого состояния было secondary, а канон — primary
//     (SearchPage «Сбросить фильтры», реестр #6).
//  5. (2026-10-19) сегмент «Все / Водитель / Пассажир» оставался «облаком
//     пилюль» по содержимому и на 16px, пока два других фильтра приложения
//     (уведомления, даты в поиске) — равные сегменты 12px.
//
// Пины текстовые: jsdom не каскадит CSS-модули и не считает layout
// (прецедент homeVisual.test.ts/searchVisual.test.ts). Реальные размеры
// контролирует замер в браузере.
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

const pageTsx = code(readSrc("pages/TripActive/TripActivePage.tsx"));
const pageCss = readSrc("pages/TripActive/TripActivePage.module.css");
const classesTsx = readSrc("ui/classes.ts");
const uiCss = readSrc("ui/ui.module.css");

/** Тело правила, чей селектор стоит отдельной строкой (`sel {`). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ??
    ""
  );
}

describe("поездки: строка поиска — компактная, без хешей кита", () => {
  it("резерв кита снимает FIELD_COMPACT, а не селектор по хешу", () => {
    expect(pageTsx).toMatch(/FIELD_COMPACT/);
    expect(pageTsx).toMatch(
      /className=\{`\$\{styles\.searchRow\} \$\{FIELD_COMPACT\}`\}/,
    );
    // Хеш кита в модуле экрана — долг, который молча вернётся при bump
    // версии (реестр #44). Здесь он ещё и не матчил ничего.
    expect(pageCss).not.toMatch(/:global\(/);
    expect(pageCss).not.toMatch(/\.tgui-[0-9a-f]{8,}/);
  });

  it("правило компактности одно на приложение (реестр #40)", () => {
    expect(classesTsx).toMatch(/FIELD_COMPACT = styles\.fieldCompact/);
    expect(ruleBody(uiCss, ".fieldCompact > div")).toMatch(/padding:\s*0/);
  });

  it("пилюля поиска по-прежнему наша: заливка и скругление", () => {
    expect(ruleBody(pageCss, ".searchField.searchField")).toMatch(
      /background:\s*var\(--tgui--tertiary_bg_color\)/,
    );
    expect(ruleBody(pageCss, ".searchField.searchField")).toMatch(
      /border-radius:\s*var\(--app-radius-pill\)/,
    );
  });
});

describe("поездки: действия — как на остальных экранах", () => {
  it("«Найти поездку» — primary с иконкой слотом before", () => {
    expect(pageTsx).toMatch(
      /<Button[\s\S]{0,160}?variant="primary"[\s\S]{0,80}?before=\{<SearchIcon size=\{18\} \/>\}[\s\S]{0,120}?>\s*Найти поездку/,
    );
  });

  it("«Создать поездку» — иконка +, а не плюс в подписи", () => {
    expect(pageTsx).toMatch(/before=\{<Plus size=\{18\} \/>\}/);
    expect(pageTsx).not.toContain("+ Создать поездку");
  });

  it("действие пустого состояния — primary, одно на три ветки", () => {
    // Три ветки (Все/Водитель/Пассажир) берут одну и ту же кнопку.
    expect(pageTsx.match(/emptyAction=\{emptyAction\}/g) ?? []).toHaveLength(3);
    const action = pageTsx.match(
      /const emptyAction = \(([\s\S]*?<\/Button>\s*)\);/,
    )?.[1];
    expect(action).toBeTruthy();
    expect(action).toContain('variant="primary"');
    // Свои подписи на оба состояния, а не одна на всё.
    expect(action).toContain("Сбросить поиск");
    expect(action).toContain("История поездок");
  });

  it("пустое состояние поиска — своя запись, без «других дат»", () => {
    expect(pageTsx).toMatch(
      /searching\s*\?\s*EMPTY_STATES\.myTripsNoResults\.header/,
    );
    expect(pageTsx).toMatch(
      /searching\s*\?\s*EMPTY_STATES\.myTripsNoResults\.description/,
    );
    // Экрана дат здесь нет — описание экрана поиска было бы враньём.
    expect(pageTsx).not.toMatch(/searching[\s\S]{0,60}searchNoResults/);
  });
});

describe("сегмент «Все / Водитель / Пассажир» — как остальные фильтры", () => {
  // Один и тот же фасад (`ui/Switcher`) на трёх экранах фильтров не может
  // выглядеть по-разному. Замер в Chromium на 390px до правки: «Поездки» —
  // облако по содержимому 51/95/99px, шрифт 16px, gap 6, перенос;
  // «Уведомления» — 100/100/100, 12px, gap 2, nowrap. Причина — забытая
  // опция `stretch` (реестр #43), а не осознанный выбор: подпись «Все»
  // шириной в слово рядом с «Пассажир» читалась как недоделанный контрол.
  it("все три фильтра вызывают Switcher со stretch", () => {
    for (const [file, src] of [
      ["pages/TripActive/TripActivePage.tsx", pageTsx],
      [
        "pages/Notifications/NotificationsPage.tsx",
        code(readSrc("pages/Notifications/NotificationsPage.tsx")),
      ],
      ["pages/Search/SearchPage.tsx", code(readSrc("pages/Search/SearchPage.tsx"))],
    ] as const) {
      expect(src, file).toMatch(/<Switcher[\s\S]{0,400}?stretch/);
    }
  });

  it("stretch — равные сегменты, 12px и без переноса (реестр #43)", () => {
    const switcherCss = readSrc("ui/Switcher.module.css");
    expect(ruleBody(switcherCss, ".stretch")).toMatch(/flex-wrap:\s*nowrap/);
    expect(ruleBody(switcherCss, ".stretch > *")).toMatch(/flex:\s*1 1 0/);
    expect(ruleBody(switcherCss, ".stretch > * *")).toMatch(
      /font-size:\s*12px/,
    );
  });
});

describe("состояние ошибки: retry — главное действие, значит primary", () => {
  // «Повторить» — единственная кнопка экрана ошибки, то есть главное
  // действие (реестр #6). Без варианта она была secondary и расходилась
  // с тем же «Повторить» на терминальном экране аккаунта.
  it("QueryState (общий для списков)", () => {
    const queryTsx = code(readSrc("components/QueryState.tsx"));
    expect(queryTsx).toMatch(
      /<Button size="m" variant="primary" onClick=\{onRetry\}>/,
    );
  });

  it("EmptyState ошибки деталей поездки и заявок", () => {
    for (const file of [
      "pages/TripDetails/TripDetailsPage.tsx",
      "components/Trip/TripRequestsModal.tsx",
    ]) {
      const src = code(readSrc(file));
      const retry = src.match(/<Button[\s\S]{0,200}?Повторить/g) ?? [];
      expect(retry, file).toHaveLength(1);
      expect(retry[0], file).toContain('variant="primary"');
    }
  });

  it("терминальный экран аккаунта залит так же", () => {
    const stateTsx = code(readSrc("pages/AccountStatePage/AccountStatePage.tsx"));
    expect(stateTsx).toMatch(
      /<Button[\s\S]{0,80}?variant="primary"[\s\S]{0,120}?>\s*\{label\}/,
    );
  });
});
