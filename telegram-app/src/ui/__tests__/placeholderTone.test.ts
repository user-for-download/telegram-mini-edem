// Пин тона плейсхолдера в ui/ui.module.css.
//
// ЧИТАЕМ CSS-фАЙЛ, а не DOM: дефект, который этот тест ловит, в jsdom и в
// renderToString не виден — он живёт в разборе селекторов движком. Chromium
// отбрасывает весь список селекторов, если в нём есть незнакомый
// `::-moz-placeholder`, из-за чего правило целиком переставало применяться, а
// тон оставался китовским (2.02:1) — молча, без ошибок в консоли.
//
// Поэтому здесь два утверждения:
//   1) есть правило, задающее --app-muted для ::placeholder;
//   2) НИ ОДНО правило не мешает `::-moz-placeholder` (или -webkit-) в один
//      список селекторов с обычным ::placeholder.
//
// Числовую границу контраста считает e2e/ui-contrast.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Комментарии вырезаем ДО разбора правил: иначе текст комментария про
// `::-moz-placeholder` попадёт в «селектор» и тест будет врать.
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

describe("тон плейсхолдера (ui/ui.module.css)", () => {
  it("правило для ::placeholder есть и задаёт --app-muted", () => {
    const target = rules().filter(
      (rule) => rule.selector.includes("::placeholder") && !rule.selector.includes("-moz-"),
    );
    expect(target.length).toBeGreaterThan(0);
    expect(
      target.some((rule) => rule.body.includes("var(--app-muted)")),
    ).toBe(true);
  });

  it("движко-специфичные псевдоэлементы не смешаны с обычным ::placeholder", () => {
    // Регресс на молчаливый откабс: Chromium не знает ::-moz-placeholder и
    // выбрасывает весь список селекторов, то есть правило перестаёт действовать
    // целиком — без единой ошибки в консоли.
    for (const rule of rules()) {
      const isPlain = /(?<!-)\b::placeholder/.test(rule.selector);
      const isEngineSpecific =
        rule.selector.includes("::-moz-placeholder") ||
        rule.selector.includes("::-webkit-input-placeholder");
      expect(
        isPlain && isEngineSpecific,
        `движко-специфичный псевдоэлемент в одном списке с ::placeholder: «${rule.selector}»`,
      ).toBe(false);
    }
  });
});