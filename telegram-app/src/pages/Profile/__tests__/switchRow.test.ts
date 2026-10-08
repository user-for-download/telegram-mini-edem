// Что страница профиля делает со строкой-переключателем.
//
// САМА строка уехала в фасад `ui/SwitchRow` (правило нужно не одному экрану:
// настройки профиля и форма создания поездки). Контракт компонента —
// `ui/__tests__/switchRow.test.tsx`, там же DOM-пины на `role="switch"`,
// отсутствие `aria-checked` и отсутствие вложенной кнопки. Здесь осталось
// ровно то, что знает только страница:
//
//  1. строка ЖИВЁТ в `ui/`, а не объявлена приватно здесь (иначе правило
//     разъедется со вторым экраном, ради которого и вынесено);
//  2. у строки-переключателя нет своей рамки и ширины — прежний дефект
//     переполнения за правый край;
//  3. строки идут прямыми детьми `Section` (без `Stack`-обёртки), иначе
//     Section перестаёт ставить между ними разделители.
//
// Тест ловит именно форму, а не вид: «своя рамка» и «обёртка Stack» — это
// дефекты, которые возвращаются молча.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "..", "ProfilePage.tsx"), "utf8");
const pageCss = readFileSync(
  join(here, "..", "ProfilePage.module.css"),
  "utf8",
);

/**
 * CSS без комментариев. Обязательно: иначе тест ловит текст комментария —
 * ровно как ловил бы текст правила, которое мы хотим запретить.
 */
const pageCssCode = pageCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("строка-переключатель живёт в ui/, а не в странице", () => {
  it("страница импортирует SwitchRow из фасада", () => {
    // Признак «нужно не одному экрану» — причина выноса (MEMORY §7,
    // «Правило №5» в ui/README.md). Пин на импорт, а не на использование:
    // иначе возврат приватной копии прошёл бы, пока страница зовёт фасад.
    expect(pageSrc).toMatch(/import\s*\{\s*SwitchRow\s*\}\s*from\s*"@\/ui\/SwitchRow"/);
  });

  it("приватного объявления SwitchRow на странице не осталось", () => {
    // Копия на странице — это ровно то, что вынос устраняет: правило,
    // нужно двум экранам, живёт в одном.
    expect(pageSrc).not.toMatch(/function\s+SwitchRow\b/);
    expect(pageSrc).not.toMatch(/<Switch\b/);
  });

  it("китовский Switch страницу не касается — фасад владеет переключателем", () => {
    // Смысл тот же, что у «Switch вне SwitchRow»: если роль switch
    // проставлена только в одной копии, второй экран останется чекбоксом.
    // Смотрим ТОЛЬКО тело импорта кита — по всему файлу регулярка ловила бы
    // любое слово «Switch» дальше по тексту.
    const kitImport =
      pageSrc.match(
        /import\s*\{([^}]*)\}\s*from\s*"@telegram-apps\/telegram-ui"/,
      )?.[1] ?? "";
    expect(kitImport).not.toMatch(/\bSwitch\b/);
  });
});

describe("переполнение по ширине не вернётся", () => {
  it("в ProfilePage.module.css больше нет класса .switchRow", () => {
    expect(pageCssCode).not.toMatch(/\.switchRow\b/);
    expect(pageSrc).not.toMatch(/styles\.switchRow/);
  });

  it("нет своей рамки/поверхности у строки-переключателя", () => {
    // Поверхность и разделители даёт Section; свой border/background у строки
    // означал бы возврат прежнего дефекта.
    expect(pageCssCode).not.toMatch(/\.switchRow[\s\S]*?\bborder\s*:/);
  });

  it("общий инвариант модулей: width:100% идёт только с box-sizing", () => {
    // Причина переполнения была механической: content-box + width:100% +
    // горизонтальный padding/border. Проверяем все модули страницы, чтобы
    // тот же дефект не всплыл на другой строке.
    // Группы всегда на месте (саргмент 1 — имя, 2 — тело), но noUncheckedIndexedAccess
    //   делает их `string | undefined` — сужаем явно, иначе тест не компилируется.
    const rules = [...pageCssCode.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)].map(
      (m) => ({ name: m[1] ?? "", body: m[2] ?? "" }),
    );
    const offenders = rules
      .filter((r) => /width\s*:\s*100%/.test(r.body))
      .filter((r) => !/box-sizing\s*:\s*border-box/.test(r.body))
      .filter((r) => /(padding|border)\s*:/.test(r.body))
      .map((r) => `.${r.name}`);
    expect(offenders, "width:100% без box-sizing:border-box при padding/border").toEqual(
      [],
    );
  });
});

describe("разделители секций работают", () => {
  it("строки-переключатели — прямые дети Section, без Stack-обёртки", () => {
    // Section вставляет Divider между прямыми детьми; обёртка скрывает их.
    // Граница 2000 символов — не произвольная: на 400 тест молча проходил
    // при ВОССТАНОВЛЕННОЙ обёртке Stack, потому что две строки-переключателя
    // занимают ~700 символов и regex не дотягивался до закрывающего </Stack>.
    const offenders: string[] = [];
    for (const m of pageSrc.matchAll(
      /<Section[^>]*>\s*<Stack[^>]*>([\s\S]{0,2000}?)<\/Stack>/g,
    )) {
      if (/<SwitchRow|<MenuRow/.test(m[1]!)) offenders.push(m[0]!.slice(0, 60));
    }
    expect(
      offenders,
      "SwitchRow/MenuRow внутри Stack — разделители Section не появятся",
    ).toEqual([]);
  });
});
