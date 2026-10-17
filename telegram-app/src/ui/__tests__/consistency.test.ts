// Кросс-компонентная согласованность слоя ui: правила, которые обязаны
// совпадать ВЕЗДЕ, а не в одном экране.
//
// Найдено при аудите 2026-10-17: фокус-кольцо объявлялось в 10 модулях
// ТРЕМЯ разными рецептами (сырой `--tgui--link_color`, `--app-info`,
// `currentColor`) — то есть клавиатурный фокус выглядел по-разному на
// соседних экранах, а в светлой теме сырой тон ещё и не проходил AA.
//
// Тест текстовый: jsdom не считает `color-mix` и не каскадит CSS-модули
// (прецедент layoutCss.test.ts), а правило здесь про ОБЪЯВЛЕННЫЕ значения.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..");

/** Все CSS-модули приложения (без node_modules). */
function walkCss(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walkCss(full, acc);
    } else if (entry.endsWith(".css")) {
      acc.push(full);
    }
  }
  return acc;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const CSS_FILES = walkCss(SRC);

describe("фокус-кольцо: один рецепт на всё приложение", () => {
  const tokenCss = stripComments(readFileSync(join(SRC, "index.css"), "utf8"));

  it("толщина объявлена токеном, а не литералом в каждом модуле", () => {
    expect(tokenCss).toMatch(/--app-focus-width:\s*2px/);
  });

  it("каждое правило :focus-visible с outline читает токен и --app-info", () => {
    const offenders: Array<{ file: string; rule: string; body: string }> = [];
    for (const file of CSS_FILES) {
      const css = stripComments(readFileSync(file, "utf8"));
      for (const match of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
        const selector = match[1] ?? "";
        // Сброс кольца — это `:focus:not(:focus-visible)`, а не позитивное
        // правило: он обязан гасить outline, а не задавать его.
        if (selector.includes(":not(:focus-visible)")) continue;
        const body = match[2] ?? "";
        if (!/(^|[;\s])outline\s*:/.test(body)) continue;
        const outline = body.match(/(^|[;\s])outline\s*:\s*([^;]+)/)?.[2]?.trim();
        if (outline !== "var(--app-focus-width) solid var(--app-info)") {
          offenders.push({
            file: file.slice(SRC.length + 1),
            rule: selector.trim(),
            body: outline ?? "",
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ни один outline не читает сырой китовый токен или currentColor", () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      const css = stripComments(readFileSync(file, "utf8"));
      for (const match of css.matchAll(/outline\s*:\s*([^;]+)/g)) {
        const value = match[1] ?? "";
        if (/--tgui--link_color|currentColor|#[0-9a-f]{3,8}\b/i.test(value)) {
          offenders.push(`${file.slice(SRC.length + 1)} → ${value.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("сырой --tgui--link_color не используется цветом в модулях-потребителях", () => {
    // Реестр #38: смысловые цвета — только через --app-* (иначе тёмная тема
    // не может подкрутить тон). index.css — единственное место, где сырой
    // китовый токен превращается в смысловой.
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      if (file.endsWith(join("src", "index.css"))) continue;
      const css = stripComments(readFileSync(file, "utf8"));
      if (/var\(--tgui--link_color/.test(css)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("отступы пилюли статуса принадлежат раскладке, а не пилюле", () => {
  it("StatusPill сбрасывает китовый margin в 0 (без своего 6px слева)", () => {
    const css = stripComments(
      readFileSync(join(SRC, "components", "StatusPill", "StatusPill.module.css"), "utf8"),
    );
    const body = css.match(/^[ \t]*\.pill[ \t]*\{([^}]*)\}/m)?.[1] ?? "";
    expect(body).toMatch(/margin:\s*0;/);
    expect(body).not.toMatch(/margin:\s*0\s+0\s+0\s+6px/);
  });
});

describe("заголовок группы — одна реализация на все шторки", () => {
  it("ui/GroupLabel: 13/600 + приглушённый тон, без своих отступов", () => {
    const css = stripComments(
      readFileSync(join(SRC, "ui", "GroupLabel.module.css"), "utf8"),
    );
    const body = css.match(/^[ \t]*\.label\.label[ \t]*\{([^}]*)\}/m)?.[1] ?? "";
    expect(body).toMatch(/color:\s*var\(--app-muted\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).toMatch(/margin:\s*0/);
    // Отступы — родителя (SheetBody/Stack): паддинг у метки разъехался бы
    // с карточками, у которых тот же рельс 16.
    expect(body).not.toMatch(/padding/);
  });

  it("локальных копий роли не осталось", () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      const css = stripComments(readFileSync(file, "utf8"));
      // Прежние имена: .groupLabel (TripModals), .sectionTitle (детали),
      // .passengersGroup (пассажиры).
      if (/\.(groupLabel|sectionTitle|passengersGroup)\b/.test(css)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
