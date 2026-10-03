// Строка-переключатель профиля: инварианты «как в стандарте кита».
//
// Была самодельная строка: `div.switchRow` со своей рамкой, фоном и
// `width: 100%`. Замер в браузере показал не косметику, а дефект:
//   356 (родитель) + 24 (padding 12×2) + 2 (border 1×2) = 382px при
//   `box-sizing: content-box` → переполнение 26px и уход за правый край.
// Плюс `Section` вставляет `Divider` только между ПРЯМИМИ детьми, а строки
// были завёрнуты в `Stack` — кит видел один узел, разделителей не было.
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
 * CSS без комментариев. Обязательно: удалённое правило `.switchRow`
 * задокументировано в комментарии («удалён 2026-10-01, потому что…»), и
 * без чистки тест ловит сам этот комментарий — ровно как ловил бы текст
 * правила, которое мы хотим запретить.
 */
const pageCssCode = pageCss.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Исходник страницы без комментариев. Обязательно: роль switch обсуждается
 * в комментарии рядом с ней, и без чистки тест на `role="switch"` проходил бы
 * на тексте комментария — ровно тот класс молчаливых тестов, который сам же
 * ловит в CSS-части этого файла.
 */
const pageSrcCode = pageSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Тело функции SwitchRow. */
const switchRowBody = (): string => {
  const start = pageSrc.indexOf("function SwitchRow(");
  expect(start, "SwitchRow не найдена").toBeGreaterThan(-1);
  const end = pageSrc.indexOf("\n}\n", start);
  return pageSrc.slice(start, end);
};

/**
 * То же тело без комментариев. Роль switch обсуждается в комментарии прямо
 * над атрибутом, поэтому проверять надо именно код: иначе тест находит
 * `role="switch"` в тексте комментария и проходит, даже если атрибут убрали.
 */
const switchRowCode = (): string =>
  switchRowBody().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("SwitchRow: стандартный паттерн (Cell + Switch в after)", () => {
  it("рендерится через ui/Cell, а не через div с собственным классом", () => {
    const body = switchRowBody();
    expect(body).toMatch(/<Cell\b/);
    // Собственный div-контейнер с классом — ровно то, что было сломано.
    expect(body).not.toMatch(/<div\s+className=/);
  });

  it("переключатель лежит в слоте after", () => {
    expect(switchRowBody()).toMatch(/after=\{[\s\S]*?<Switch\b/);
  });

  it("строка НЕ кликабельна целиком: Switch не вложен в кнопку", () => {
    // Нативный checkbox внутри <button> — невалидная вложенность, и двойное
    // срабатывание на Enter/Space. Переключать должен сам Switch.
    const body = switchRowBody();
    expect(body).not.toMatch(/Component="button"/);
    expect(body).not.toMatch(/onClick=/);
  });

  it("подпись и иконка передаются в слоты Cell", () => {
    const body = switchRowBody();
    expect(body).toMatch(/before=\{icon\}/);
    expect(body).toMatch(/subtitle=\{subtitle\}/);
  });

  it("клетка несёт a11y-имя переключателя", () => {
    expect(switchRowBody()).toMatch(/aria-label=\{label\}/);
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
      // делает их `string | undefined` — сужаем явно, иначе тест не компилируется.
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

describe("SwitchRow: роль switch, а не чекбокс", () => {
  it("на переключателе стоит role=switch", () => {
    // Замер 2026-10-03: китовский Switch — это input[type=checkbox], и роль
    // из обёртки не приходила (role=null на всех трёх тумблерах профиля).
    // Скринридер озвучивал «отмечено/не отмечено» вместо «включено/выключено».
    expect(switchRowCode()).toMatch(/<Switch\b[^>]*role="switch"/);
  });

  it("Switch вне SwitchRow тоже объявлен переключателем", () => {
    // Тумблер темы рисуется не через SwitchRow, но семантика та же: если
    // роль проставили только в SwitchRow, тема останется чекбоксом.
    const switches = pageSrcCode.match(/<Switch\b/g) ?? [];
    const withRole = pageSrcCode.match(/<Switch\b[\s\S]{0,400}?role="switch"/g) ?? [];
    expect(switches.length).toBeGreaterThan(0);
    expect(
      withRole.length,
      "не все <Switch> несут role=\"switch\"",
    ).toBe(switches.length);
  });

  it("aria-checked не задаётся руками", () => {
    // Для input[type=checkbox] браузер выводит aria-checked из checked.
    // Дублирование рискует разойтись с реальным состоянием — ловим молчаливый
    // возврат через лишний атрибут.
    expect(switchRowCode()).not.toMatch(/aria-checked/);
  });
});
