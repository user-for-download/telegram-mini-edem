// Визуальный контракт уведомлений (NotificationsPage).
//
// До 2026-10-18 строка ленты была «таблицей из трёх фактов»:
//  1. третья строка — четыре факта в одну линию 15px в 247px: маршрут
//     обрезался на «Вологда → Чере…», то есть терялось самое нужное;
//     разрешить перенос оказалось не лучше — рвалось посередине
//     («Вологда →» / «Сокол»), и направление читалось как два факта;
//  2. правая колонка — шеврон сверху и дата под ним: шеврон обещал
//     «открыть» у каждой строки, а дата висела по центру пустой колонки;
//  3. непрочитанное — одна точка 6px: после «Прочитать все» лента почти не
//     менялась;
//  4. сегменты — «облако» по содержимому рядом с одинокой иконкой у правого
//     края, плюс зазор 6px (off-scale);
//  5. подпись даты в правой колонке цеплялась за ХЕШ-КЛАСС кита
//     (`:global(.tgui-4af09…)`) — ломается при любом обновлении telegram-ui.
//
// Пины текстовые: jsdom не каскадит CSS-модули и не считает layout
// (прецедент homeVisual.test.ts / searchVisual.test.ts).
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

const pageTsx = code(readSrc("pages/Notifications/NotificationsPage.tsx"));
const pageCss = code(
  readSrc("pages/Notifications/NotificationsPage.module.css"),
);

/** Тело правила, чей селектор стоит отдельной строкой (`sel {`). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ??
    ""
  );
}

describe("уведомления: строка как чат-лист", () => {
  it("мета и маршрут — две смысловые строки, а не один поток", () => {
    // Один поток рвался посередине маршрута: «Вологда →» / «Сокол».
    expect(ruleBody(pageCss, ".detail")).toMatch(/flex-direction:\s*column/);
    expect(pageTsx).toContain("styles.meta");
    expect(pageTsx).toContain("styles.route");
    // Каждая часть обрезается целиком, а не рвётся на «→»: правило общее
    // для обеих строк (`.meta,\n.route { … }`).
    expect(pageCss).toMatch(
      /\.meta,\s*\n\.route \{[^}]*text-overflow:\s*ellipsis/,
    );
    // Маршрут — главное в третьей строке, тон основной. Отдельным
    // правилом: у общего с `.meta` тела цвета нет намеренно.
    expect(pageCss).toMatch(
      /\.route \{[^}]*color:\s*var\(--tgui--text_color\)/,
    );
  });

  it("время — сверху правой колонки, без шеврона", () => {
    // Шеврон стоял над датой и обещал «открыть» у каждой строки; дата
    // висела по центру пустой колонки.
    expect(pageTsx).not.toContain("ChevronRight");
    expect(pageTsx).not.toContain("<Info");
    expect(ruleBody(pageCss, ".side")).toMatch(/align-content:\s*start/);
  });

  it("непрочитанное видно подложкой строки, а не только точкой", () => {
    // Точка 6px — слишком слабый признак: после «Прочитать все» лента
    // почти не менялась.
    expect(pageTsx).toMatch(
      /data-unread=\{!notification\.isRead \? "true" : undefined\}/,
    );
    expect(ruleBody(pageCss, '.cell.cell[data-unread="true"]')).toMatch(
      /background:\s*var\(--tgui--secondary_bg_color\)/,
    );
    // Тон нейтральный: акцентная плашка в приложении = ВЫБРАННЫЙ элемент.
    expect(pageCss).not.toContain("--app-info-bg");
  });

  it("колонка маркера зарезервирована — время не дёргается", () => {
    // Без резерва время ездило влево-вправо на 14px от строки к строке.
    const side = ruleBody(pageCss, ".side");
    expect(side).toMatch(/grid-template-columns:\s*auto 8px/);
    expect(ruleBody(pageCss, ".time")).toMatch(/grid-column:\s*1/);
    expect(ruleBody(pageCss, ".unread.unread")).toMatch(/grid-column:\s*2/);
  });

  it("тексту хватает ширины: зазор тела 16px, а не 24px кита", () => {
    // 24px съедали у текста ровно столько, что обрезалась вторая строка
    // («Ирина Козлова • найдена поезд…»).
    expect(ruleBody(pageCss, ".cell.cell")).toMatch(
      /gap:\s*var\(--app-space-md\)/,
    );
  });
});

describe("уведомления: шапка", () => {
  it("сегменты растянуты на полосу ленты", () => {
    // Три пилюли разной ширины плюс одинокая иконка у правого края
    // читались как три разных элемента, а не один переключатель. Равные
    // сегменты и отсутствие переноса даёт сам фасад (ui/Switcher `.row`,
    // реестр #53); за экраном остаётся полоса — переключатель сидит в том
    // самом блоке, что делит строку с иконкой.
    expect(pageTsx).toMatch(/styles\.segments\}\s*>\s*<Switcher/);
    expect(ruleBody(pageCss, ".chipRow")).toMatch(
      /gap:\s*var\(--app-space-xs\)/,
    );
    expect(ruleBody(pageCss, ".segments")).toMatch(/flex:\s*1 1 auto/);
  });
});

describe("уведомления: без зависимости от хешей кита", () => {
  it("правая колонка не цепляется за хеш-класс tgui", () => {
    // `:global(.tgui-4af039094fb946b4)` ломался при любом обновлении
    // telegram-ui: подпись даты молча возвращалась к 15px и переносилась.
    expect(pageCss).not.toMatch(/:global\(/);
    // Именно ХЕШ-классы кита (`.tgui-<16 hex>`), а не токены `--tgui--*`:
    // токены — законный язык системы (реестр #20/#21).
    expect(pageCss).not.toMatch(/\.tgui-[0-9a-f]{8,}/);
  });
});
