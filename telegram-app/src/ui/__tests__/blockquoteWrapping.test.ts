// Пин ПРАВИЛ ПЕРЕНОСОВ в ui/ui.module.css.
//
// Зачем отдельный файл: тесты потребителей (TripHero, ProfilePage) проверяют,
// что класс `.quote` ДОЕХАЛ до DOM, — но сам по себе класс ничего не значит.
// Если правило перестанет объявлять `white-space`/`overflow-wrap`, все эти
// проверки останутся зелёными, а переносы, набранные человеком, снова
// склеятся. Здесь закрывается вторая половина цепочки: класс применён ⇐
// класс означает именно переносы.
//
// ЧИТАЕМ CSS-ФАЙЛ, а не DOM: в jsdom нет `getComputedStyle` для неслойных
// модулей (ui/README, «чего эти проверки не ловят»), а сам визуальный итог —
// перенос строки, длинное слово — в jsdom не проверяемый в принципе. Его
// снимает браузер. Здесь assert-ится правило, а не картинка.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Комментарии вырезаем ДО разбора правил: текст про `pre-wrap` в комментарии
// иначе попал бы в «селектор» и тест врал бы в обе стороны.
const css = readFileSync(
  fileURLToPath(new URL("../ui.module.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Блоки вида `селекторы { … }` — достаточно для плоского CSS модуля. */
function rules(): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? "",
  }));
}

/** Тело правила с точным селектором `.quote` (без[data-tone]-вариантов). */
function quoteRule(): string {
  const rule = rules().find((r) => r.selector === ".quote");
  if (rule === undefined) {
    throw new Error(
      "ui.module.css: правило `.quote` не найдено — переносы не применятся",
    );
  }
  return rule.body;
}

describe("правила свободного текста (ui/ui.module.css, .quote)", () => {
  it("переносы, набранные человеком, не склеиваются: white-space: pre-wrap", () => {
    // Регресс F20/F21: без этого правила комментарий водителя и «О себе»
    // показывались одной строкой, а перенос, набранный человеком, исчезал.
    expect(quoteRule()).toMatch(/white-space\s*:\s*pre-wrap/);
  });

  it("длинное слово без пробела не вылезает за плашку: overflow-wrap: anywhere", () => {
    // Ссылка или имя файла в комментарии водителя — типичный случай: токен
    // длиннее строки, и без этого правила он выдавливал бы блок.
    expect(quoteRule()).toMatch(/overflow-wrap\s*:\s*anywhere/);
  });
});
