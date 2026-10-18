// Визуальный контракт главной (HomePage).
//
// До 2026-10-17 главная «рассыпалась» по трём причинам, и все три были
// не про вкус, а про разнобой:
//  1. off-scale отступы `margin-top: 30px` у баннера и карточки поиска —
//     30 нет в шкале --app-space-*, и после margin-collapsing с ритмом
//     страницы (12) между блоками получалась дыра в 42px;
//  2. карточка поиска занимала 339px: кит резервирует в FormInput 20px
//     под СВОЙ header, которого мы не рисуем (подпись рисует ui/Field),
//     плюс паддинг карточки 20/16 и кнопка с отступом 20 — третьим
//     значением ритма в одном блоке;
//  3. два промо-блока на ui/EmptyState (Placeholder) внизу: это компонент
//     ПУСТОГО состояния, а не призыва к действию — та же ошибка роли, что
//     была у попапа жалобы (реестр #35). Два таких блока — ~460px.
//
// Пины текстовые: jsdom не каскадит CSS-модули и не считает layout
// (прецедент tripCardVisual.test.ts, layoutCss.test.ts). Реальные размеры
// контролирует e2e/ui-cascade.mjs и ui-rhythm.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", "..", relativePath), "utf8");

const homeTsx = code(readSrc("pages/HomePage/HomePage.tsx"));
const homeCss = readSrc("components/Section/TripSearchSection.module.css");
const searchTsx = code(readSrc("components/Section/TripSearchSection.tsx"));
const bannerCss = readSrc("components/Section/NextTripBanner.module.css");
const actionsTsx = code(readSrc("components/Section/HomeActionsSection.tsx"));
const fieldTsx = code(readSrc("ui/Field.tsx"));
const uiCss = readSrc("ui/ui.module.css");

/** Код без комментариев: пины смотрят на разметку и импорты, а не на текст
 *  объяснений — сами комментарии здесь ссылаются на Placeholder/EmptyState,
 *  и без срезания проверка «их больше нет» ловила бы сам комментарий. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Тело правила, чей селектор стоит отдельной строкой (`sel {`). */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

describe("главная: ритм без off-scale отступов", () => {
  // 30px не входит в шкалу --app-space-*; вместе с ритмом страницы он давал
  // дыру между блоками, а сам себя оправдывал ссылкой на соседний блок.
  it("ни баннер, ни карточка поиска не задают верхний отступ 30px", () => {
    expect(bannerCss).not.toMatch(/margin(-top)?:\s*30px/);
    expect(homeCss).not.toMatch(/margin(-top)?:\s*30px/);
    expect(ruleBody(bannerCss, ".banner.banner")).toMatch(/margin:\s*0/);
  });

  it("карточка поиска — на карточном паддинге и общем шаге", () => {
    expect(ruleBody(homeCss, ".searchCard.searchCard")).toMatch(
      /padding:\s*var\(--app-card-pad\)/,
    );
    expect(ruleBody(homeCss, ".submit")).toMatch(
      /margin-top:\s*var\(--app-space-md\)/,
    );
    // Бок карточки обязан совпадать с карточкой баннера: раньше поиск был
    // шире на 4px, и два соседних блока имели разные вертикали.
    expect(homeCss).not.toMatch(/padding:\s*20px 16px/);
  });
});

describe("главная: компактное поле поиска", () => {
  // Кит отдаёт форме `padding: 20px 22px 16px` под свой header
  // (FormInputTitle) ВСЕГДА, даже когда header не передан: заголовок поля
  // рисует ui/Field. Без компактного режима контрол — 84px при 26px текста.
  it("Field умеет compact и снимает ровно резерв кита", () => {
    expect(fieldTsx).toMatch(/compact\?: boolean/);
    expect(fieldTsx).toMatch(/compact \? styles\.fieldCompact/);
    expect(ruleBody(uiCss, ".fieldCompact > div")).toMatch(/padding:\s*0/);
  });

  it("оба селекта главной — компактные", () => {
    expect(searchTsx.match(/\n\s+compact\n/g) ?? []).toHaveLength(2);
    expect(searchTsx).not.toMatch(/compact=\{/); // режим включён, а не прокинут
  });
});

describe("главная: действия — строки, а не Placeholder", () => {
  it("HomePage не рисует промо-EmptyState", () => {
    expect(homeTsx).not.toMatch(/EmptyState/);
    expect(homeTsx).toContain("<HomeActionsSection");
  });

  it("секция действий — MenuRow, а не пустое состояние", () => {
    expect(actionsTsx).not.toMatch(/EmptyState|Placeholder/);
    expect(actionsTsx).toMatch(/<MenuRow/);
  });

  it("вопросы остались видны, но обрезаться не могут", () => {
    // MenuRow режет подпись примерно на 30-м символе, поэтому в строке
    // остаётся только вопрос («Едете на машине?»), а объяснение — на форме.
    expect(actionsTsx).toContain('subtitle="Едете на машине?"');
    expect(actionsTsx).toContain('subtitle="Нужна попутка?"');
  });
});
