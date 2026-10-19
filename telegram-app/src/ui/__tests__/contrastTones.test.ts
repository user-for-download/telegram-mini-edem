// ПИН ТОНА ТРЁХ ФАСАДНЫХ ПРАВИЛ, которые обходили систему `--app-*`:
//   ui/Chip.module.css      `.chip[aria-pressed="true"]`    (F9)
//   ui/Switcher.module.css  `.active`                       (F10)
//   ui/Section.module.css   `.header`                       (F11)
//
// ПОЧЕМУ ЧИТАЕМ ТЕКСТ CSS, А НЕ DOM. Тон здесь — каскадное
// `color-mix(in srgb, …)`, которое jsdom не вычисляет, а значения
// `--tgui--*` принадлежат киту: копировать их в тест значит завести второй
// источник правды (та же причина, по которой числовая граница контраста живёт
// в `e2e/ui-contrast.mjs`, а не здесь). Поэтому здесь закреплено ЧТО должно
// быть написано, а сколько это даёт контраста — посчитано в браузере.
//
// ── ИЗМЕРЕНО (Chromium, те же формулы, что в `e2e/ui-contrast.mjs`) ────────
//   L = 0.2126R + 0.7152G + 0.0722B по линеаризованным каналам,
//   контраст = (Lсветлее + 0.05) / (Lтемнее + 0.05).
//   Палитра — AppConfig.tsx LIGHT_PALETTE / DARK_PALETTE (ею откалиброваны
//   реестры #20/#21, и её же навешивает гейт через `edem:theme-override`).
//
//   Подложки. Тон лежит на ТОНИРОВАННОЙ плашке `--app-info-bg`
//   (= `--tgui--secondary_fill`), и у кита она РАЗНАЯ для платформ:
//     base: color-mix(in srgb, var(--tgui--accent_text_color) 10%/15%, transparent)
//     iOS:  rgba(67,120,255,.10) / rgba(41,144,255,.15)
//   Плюс серая плашка — зафиксированная MEMORY.md §18 как худшая поверхность,
//   и фон секции (его заголовок действительно занимает).
//
//     подложка                  светлая              тёмная
//     плашка base               rgb(230,242,255)     rgb(35,55,73)
//     плашка iOS                rgb(236,242,255)     rgb(26,50,75)
//     серая #eaeaeb/#24303c     rgb(234,234,235)     rgb(36,48,60)
//     фон секции                #ffffff              #17212b
//     --app-info                rgb(0,101,212)       rgb(106,179,243)
//
//   было → стало (светлая / тёмная):
//   F9  было  #fff на --tgui--button_color:      4.02:1 / 3.72:1   ✗ AA
//       стало --app-info на своей плашке:       4.86 / 5.46  (base)
//                                                  4.91 / 5.84  (iOS)
//                                                  4.58 / 5.99  (серая)   ✓ AA
//   F10 было  --tgui--link_color на плашке:      3.54 / 5.46  (base)
//                                                  3.58 / 4.08  (iOS, статический
//                                                             тёмный фолбэк кита)
//       стало --app-info на своей плашке:       4.86 / 5.46  (base)
//                                                  4.91 / 5.84  (iOS)
//                                                  4.58 / 5.99  (серая)   ✓ AA
//   F11 было  --tgui--link_color на секции:      4.02 / 7.26  ✗ AA (светлая)
//       стало --app-info на секции:             5.51 / 7.26
//                                                  4.58 / 5.99  (серая)   ✓ AA
//
//   Худшая из всех проверенных подложок — 4.58:1 в светлой теме. Именно её и
//   проверяют утверждения ниже: пол, посчитанный по лучшей подложке, завтра
//   протухнет на платформе iOS.
//
// ВАЖНО: `--app-info` в тёмной теме = `--tgui--link_color` кита как есть,
// без смешения (index.css, `.dark .app-theme`), потому что на тёмном фоне
// светлые смеси не нужны. Тон не переопределялся и не изобретался: правится
// только то, КАКИМ токеном эти правила читают фон и текст.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const uiDir = path.resolve(import.meta.dirname, "..");
const readUiCss = (name: string): string =>
  readFileSync(path.join(uiDir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = readFileSync(
  path.resolve(import.meta.dirname, "../../index.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Блоки `селекторы { … }` — достаточно для плоского CSS модуля. */
function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? "",
  }));
}

/** Тела правил по точному селектору (одному из списка селекторов). */
function ruleBodies(css: string, selector: string): string[] {
  return rules(css)
    .filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector))
    .map((r) => r.body);
}

/** Кит-токены, прочитанные в теле правила. */
function rawKitTokens(bodies: string[]): string[] {
  return [
    ...new Set(
      bodies.flatMap((b) =>
        [...b.matchAll(/var\((--tgui--[\w-]+)/g)].map((m) => m[1] ?? ""),
      ),
    ),
  ];
}

/** Наши токены `--app-*`, прочитанные в теле правила. */
function appTokens(bodies: string[]): string[] {
  return [
    ...new Set(
      bodies.flatMap((b) =>
        [...b.matchAll(/var\((--app-[\w-]+)/g)].map((m) => m[1] ?? ""),
      ),
    ),
  ];
}

/** Блок объявлений одной темы в index.css: от маркера до закрывающей скобки. */
function themeBlock(marker: string): string {
  const start = indexCss.indexOf(marker);
  expect(start, `маркер темы ${marker} не найден в index.css`).toBeGreaterThan(-1);
  return indexCss.slice(start, indexCss.indexOf("\n}", start));
}

/**
 * ЧТО проверяем по каждому селектору: тон текста, плашку под ним и запрет на
 * чтение сырых `--tgui--*`. Контрактные числа — ХУДШИЕ измеренные по всем
 * подложкам (плашка base, плашка iOS, серая плашка, фон секции); пол по
 * лучшей подложке протух бы на iOS.
 */
const CONTRACT = [
  {
    name: "F9 — ui/Chip.module.css .chip[aria-pressed=\"true\"]",
    file: "Chip.module.css",
    selectors: ['.chip[aria-pressed="true"]', '.chip[aria-pressed="true"] *'],
    textToken: "--app-info",
    plateToken: "--app-info-bg",
    worstLight: 4.58,
    worstDark: 5.46,
  },
  {
    name: "F10 — ui/Switcher.module.css .active",
    file: "Switcher.module.css",
    selectors: [".active.active", ".active.active *"],
    textToken: "--app-info",
    plateToken: "--app-info-bg",
    worstLight: 4.58,
    worstDark: 5.46,
  },
  {
    name: "F11 — ui/Section.module.css .header",
    file: "Section.module.css",
    selectors: [".header"],
    textToken: "--app-info",
    // Фон не перекрашивался: заголовок секции лежит на фоне самой секции.
    plateToken: null,
    worstLight: 4.58,
    worstDark: 5.46,
  },
] as const;

describe("тон Chip/Switcher/Section идёт через систему --app-* (F9/F10/F11)", () => {
  it.each(CONTRACT.map((c) => [c.name, c] as const))(
    "%s: текст задан тоном --app-*, а не сырым --tgui--*",
    (_name, contract) => {
      const css = readUiCss(contract.file);
      const bodies = contract.selectors.flatMap((s) => ruleBodies(css, s));
      expect(bodies.length, `селектор не найден в ${contract.file}`).toBeGreaterThan(0);

      // 1) Тон текста. Регресс на возврат `--tgui--link_color` /
      //    `--tgui--button_text_color` ловится здесь.
      const colorBodies = bodies.filter((b) => /(^|[;\s])color\s*:/.test(b));
      expect(colorBodies.length, `нет объявления color в ${contract.file}`).toBeGreaterThan(0);
      for (const body of colorBodies) {
        expect(
          appTokens([body]),
          `${contract.file}: текст должен браться с var(${contract.textToken}), а не с --tgui--*:\n${body}`,
        ).toContain(contract.textToken);
        expect(
          rawKitTokens([body]),
          `${contract.file}: в color остался сырой кит-токен — он не перекрывается .dark .app-theme:\n${body}`,
        ).toEqual([]);
      }

      // 2) Подложка — та же система, если она задана.
      if (contract.plateToken) {
        const backgroundBodies = bodies.filter((b) => /background\s*:/.test(b));
        expect(
          backgroundBodies.length,
          `нет объявления background в ${contract.file}`,
        ).toBeGreaterThan(0);
        for (const body of backgroundBodies) {
          expect(
            appTokens([body]),
            `${contract.file}: подложка должна быть var(${contract.plateToken})`,
          ).toContain(contract.plateToken);
          expect(rawKitTokens([body]), `${contract.file}: в фоне остался сырой кит-токен`).toEqual([]);
        }
      }

      // 3) Никаких литералов цвета: палитра — кита + смешение в index.css.
      for (const body of bodies) {
        expect(
          body,
          `${contract.file}: литерал цвета вместо токена:\n${body}`,
        ).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    },
  );

  it.each(CONTRACT.map((c) => [c.name, c] as const))(
    "%s: худший измеренный контраст ≥ AA в обеих темах (числа — в шапке файла)",
    (_name, contract) => {
      // Порог 4.5:1 — оба носителя обычного текста: подпись чипа (Caption
      // 13px) и заголовок секции (13px / 15px weight 2) крупными не считаются.
      const AA = 4.5;
      for (const [theme, worst] of [
        ["светлая", contract.worstLight],
        ["тёмная", contract.worstDark],
      ] as const) {
        expect(
          worst,
          `${contract.name}: худший контраст ${theme} темы ${worst}:1 ниже AA ${AA}:1`,
        ).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it("плашка --app-info-bg — это китовский --tgui--secondary_fill, цвет не изменился", () => {
    // Регресс на «сменили заливку чипа на свою»: если --app-info-bg перестанет
    // ссылаться на китовскую тонированную плашку, мы введём вторую палитру.
    expect(themeBlock(".app-theme {")).toMatch(
      /--app-info-bg:\s*var\(--tgui--secondary_fill\)/,
    );
  });
});

describe(".dark .app-theme — путь переопределения существует", () => {
  it("тон и подложка, которые читают три правила, объявлены в обеих темах", () => {
    const tokens = new Set(
      CONTRACT.flatMap((c) => [c.textToken, c.plateToken].filter(Boolean) as string[]),
    );
    for (const marker of [".app-theme {", ".dark .app-theme {"]) {
      const block = themeBlock(marker);
      for (const token of tokens) {
        if (marker === ".dark .app-theme {" && token === "--app-info-bg") {
          // Подложку переопределять не нужно: `--app-info-bg` ссылается на
          // `--tgui--secondary_fill`, а тот реактивен к теме сам.
          continue;
        }
        expect(block, `${marker}: токен ${token} не объявлен`).toContain(`${token}:`);
      }
    }
  });

  it("селектор именно `.dark .app-theme`, а не `.dark`", () => {
    // Иначе тёмная тема получила бы СВЕТЛЫЕ (затемнённые с чёрным) тона:
    // собственное объявление на `.app-theme` всегда бьёт унаследованное от
    // класса на предке (MEMORY.md §18).
    expect(indexCss).toMatch(/\.dark\s+\.app-theme\s*\{/);
    expect(indexCss).toContain("--app-info:");
  });

  it("тон смешивается к чёрному в светлой теме, а не к литеральному hex", () => {
    const light = themeBlock(".app-theme {");
    const info = /--app-info:\s*color-mix\(\s*in srgb,\s*var\(--tgui--link_color\)\s*(\d+)%,\s*black\s*\)/.exec(
      light,
    );
    expect(info, "--app-info в светлой теме — не color-mix к чёрному").not.toBeNull();
    // 83% — измеренный минимум для 4.5+ на худшей подложке (реестр #20).
    expect(Number(info?.[1])).toBeGreaterThanOrEqual(83);
  });

  it("три правила читали бы кит напрямую — и `.dark .app-theme` их бы не спас", () => {
    // Комментарий к предыдущим утверждениям: оверрейд перекрывает только
    // ОБЪЯВЛЕННЫЕ у него токены. Правило, читающее `--tgui--link_color`,
    // минует систему целиком — ровно тот дефект, который чинился.
    for (const file of ["Chip.module.css", "Switcher.module.css"]) {
      const css = readUiCss(file);
      const colourRules = rules(css).filter((r) => /(^|[;\s])color\s*:/.test(r.body));
      for (const rule of colourRules) {
        expect(
          rule.body,
          `${file}: правило «${rule.selector}» красит текст сырым кит-токеном`,
        ).not.toMatch(/var\(--tgui--/);
      }
    }
  });
});
