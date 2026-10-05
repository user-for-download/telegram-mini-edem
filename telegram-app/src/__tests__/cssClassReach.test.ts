// Страховка от класса багов, найденного 2026-10-01: ПРАВИЛО CSS может быть
// корректным и при этом не применяться, если его класс не дошёл до DOM.
//
// Так был сломан ui/Card: `.card.card` в ui.module.css описывал поверхность
// (theme-aware фон, radius 16, width:100%), но `ui/Card` добавлял в
// className только `cardDefault`/`cardFlush`. Селектору не на что было
// матчиться, и карточки рендерились дефолтами кита: radius 20 и фон-литерал
// #2a2a2a вместо темы Telegram. Текстовые пины CSS были зелёными.
//
// ЧТО ЗДЕСЬ ВАЖНО: ранее я ошибочно утверждал, что селектор `.X.X` требует
// класса дважды и потому «мёртв». Это НЕ так — проверено в браузере:
// `.a.a` матчит элемент с одним вхождением `a` и весит (0,2,0) против
// (0,1,0) у `.a`. Удвоение — обычный приём подъёма специфичности, и 26
// таких правил в репозитории были рабочими. Настоящая ошибка была в другом:
// класс не применялся. Этот тест ловит именно её.
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const read = (p: string): string => readFileSync(p, "utf8");
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string, ext: RegExp, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walk(full, ext, acc);
    } else if (ext.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Классы, объявленные в CSS модуля (без :global — те чужие). */
function declaredClasses(css: string): string[] {
  const code = stripComments(css);
  const out = new Set<string>();
  // Только селекторы: берём имена из начала правил и compound-частей.
  for (const m of code.matchAll(/(^|[};])\s*([^{};@]+)\{/g)) {
    const selector = m[2]!;
    for (const part of selector.split(",")) {
      if (part.includes(":global")) continue;
      // отбрасываем псевдо-элементы и вложенные комбинаторы верхнего уровня
      for (const simple of part.split(/[\s>+~]+/)) {
        const mm = /^\.([A-Za-z][\w-]*)(?![\w-])/.exec(simple);
        if (mm) out.add(mm[1]!);
      }
    }
  }
  return [...out];
}

const cssModules = () => walk(srcDir, /\.module\.css$/);
const sources = () => walk(srcDir, /\.(tsx|ts)$/);

describe("классы из CSS модулей реально применяются", () => {
  const sourcesText = sources().map((f) => read(f)).join("\n");

  it("слой ui/: каждый объявленный класс встречается в коде", () => {
    const orphans: string[] = [];
    for (const f of cssModules().filter((p) => p.includes(`${join("src", "ui")}`))) {
      for (const cls of declaredClasses(read(f))) {
        // классы переиспользуются как styles.X или через реэкспорт из
        // classes.ts, поэтому ищем само имя с точкой впереди
        // Ищем ЛЮБОЕ обращение вида <alias>.<cls> — не только styles.*:
        // layout/text классы реэкспортируются через ui/classes как константы
        // (TRUNCATE = layoutStyles.truncate), и ложные «сироты» here вредны:
        // лучше пропустить реальный баг, чем шуметь на корректном коде.
        if (!new RegExp(`\\b[A-Za-z_$][\\w$]*\\.${cls}\\b`).test(sourcesText)) {
          orphans.push(`${basename(f)}: .${cls}`);
        }
      }
    }
    expect(
      orphans,
      "класс объявлен в CSS, но нигде не применяется → правило не сматчится " +
        "ни с чем (ровно тот баг, что был с ui/Card)",
    ).toEqual([]);
  });

  it("ui/Card добавляет styles.card — иначе поверхность карточки мертва", () => {
    // Отдельная, самая ценная проверка: именно этот класс не доезжал.
    const cardSrc = read(join(srcDir, "ui", "Card.tsx"));
    expect(cardSrc).toMatch(/styles\.card\b/);
  });

  it("удвоенные селекторы в ui/ — только осознанные (их перечень конечен)", () => {
    // Удвоение легально (подъём специфичности), поэтому пин на КОЛИЧЕСТВО
    // бессмыслен: он кодировал бы цифру, а не инвариант. Пиняем список
    // явно, с обоснованием каждой строки.
    //   ui.module.css:card       — поверхность карточки, бьёт кит.
    //   Switcher.module.css:item / :active — те же два правила переехали сюда
    //   из страниц уведомлений и поездок (там был тот же приём против
    //   заливки mono/elevated кита); по 3 совпадения на класс, потому что
    //   удвоение повторяется в селекторе и в правиле «… *» для потомков.
    const doubled = cssModules()
      .filter((f) => f.includes(join("src", "ui")))
      .flatMap((f) =>
        [...stripComments(read(f)).matchAll(/\.([A-Za-z][\w-]*)\.\1(?![-\w])/g)].map(
          (m) => `${basename(f)}:${m[1]}`,
        ),
      );
    expect(doubled.sort()).toEqual([
      "Switcher.module.css:active",
      "Switcher.module.css:active",
      "Switcher.module.css:active",
      "Switcher.module.css:item",
      "Switcher.module.css:item",
      "Switcher.module.css:item",
      "ui.module.css:card",
    ]);
  });
});
