// Принцип единства блоков внутри шторки деталей поездки.
//
// Четыре блока TripHero (.routeCard, .driverCard, .carRow, .noteCard)
// держат ОДИН принцип: фон `--tgui--tertiary_bg_color`, без рамки.
// Раньше .driverCard и .noteCard стояли на `--tgui--section_bg_color` +
// `border: 1px solid --tgui--outline`, и на белом фоне шторки это читалось
// как «коробка в коробке».
//
// Проверяем ТЕКСТ CSS, а не рендер: правило здесь про объявленные
// значения, и именно они решают, виден ли блок. Пин ловит и возврат
// рамки, и возврат section_bg — обе регрессии выглядели бы «нормально»
// в jsdom, где токены не вычисляются.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssRaw = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../TripDetailsPage.module.css",
  ),
  "utf8",
);
// Комментарии вырезаны: правило .driverCard объясняет ловушку с
// section_bg_color словами, и без вырезки проверка «в модуле нет
// section_bg_color» ловила бы собственный комментарий, а не значение.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/** Тело правила по имени класса. */
function ruleOf(className: string): string {
  const match = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) throw new Error(`класс .${className} не найден в модуле`);
  // noUncheckedIndexedAccess: группа может отсутствовать — тогда тело
  // правила пустое, и проверки ниже честно провалятся, а не молча пройдут.
  return match[1] ?? "";
}

const BLOCKS = ["routeCard", "driverCard", "carRow", "noteCard"] as const;

describe("Блоки шторки деталей поездки: одна поверхность, без рамок", () => {
  it.each(BLOCKS)("%s — тонированная плашка tertiary", (block) => {
    expect(ruleOf(block)).toContain("var(--tgui--tertiary_bg_color)");
  });

  it.each(BLOCKS)("%s — без рамки", (block) => {
    expect(ruleOf(block)).not.toMatch(/border\s*:/);
  });

  it("ни один блок не стоит на section_bg: он равен фону шторки", () => {
    // Фон шторки — `--tgui--bg_color`, а китовые section_bg_color и
    // bg_color равны в обеих темах (#fff / #212121). Блок на section_bg
    // невидим: единственное, что его рисовало, — рамка, а её уже нет.
    // Поэтому возвращать section_bg нельзя — блок просто исчезнет.
    expect(css).not.toContain("section_bg_color");
  });

  it("убери рамку у driverCard — и блок всё равно виден", () => {
    // Регрессия в другую сторону: если бы фон вернулся на section_bg,
    // «просто убрать рамку» погасило бы карточку водителя целиком.
    expect(ruleOf("driverCard")).toContain("var(--tgui--tertiary_bg_color)");
  });
});
