// Страж от мёртвых удвоенных селекторов.
//
// Найдено 2026-10-01 зондом по рендеру: селектор `.X.X` трактуется в
// репозитории как «поднять специфичность». Это НЕ так — он требует, чтобы
// класс `X` стоял в атрибуте `class` ДВАЖДЫ. При одном вхождении правило не
// матчится ни к чему, и все объявленные в нём свойства молча не работают.
//
// Так были сломаны: `.card.card` (поверхность карточки — рендерилась с
// дефолтами кита и тему Telegram не читала), `.snackbar.snackbar` (тост
// висел поверх дока таббара), `.tabbar.tabbar` (док без пилюли/блюра/тени).
//
// Тест находит такие правила статически: связывает CSS-модуль с его
// потребителями через `import styles from "./X.module.css"` и смотрит,
// сколько раз класс попадает в ОДНО className-выражение.
//
// Два режима:
//  1) НОВЫЙ мёртвый селектор (не в списке) → падаем: это регрессия.
//  2) Запись из списка вдруг перестала быть мёртвой → падаем: список надо
//     почистить, иначе он врёт.
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const read = (p: string): string => readFileSync(p, "utf8");
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Все .module.css (без ui/, там это закреплено точечными тестами). */
function walkCss(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walkCss(full, acc);
    } else if (e.name.endsWith(".module.css")) acc.push(full);
  }
  return acc;
}

/** Все .tsx (без тестов). */
function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walkTsx(full, acc);
    } else if (e.name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

interface Dead {
  file: string;
  cls: string;
}

/**
 * Значения атрибутов `className` из исходника.
 *
 * Регуляркой `/className=\{([^}]*)\}/` это не сделать: шаблонный литерал
 * `${styles.x}` содержит `}` внутри фигурных скобок, выражение обрезалось
 * на первой же `}` — и живое правило объявлялось мёртвым. Ложное
 * «мёртвое» хуже отсутствия стража, поэтому здесь балансный разбор со
 * счётчиком глубины и учётом строковых литералов.
 */
function classNameValues(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className\s*=\s*/g)) {
    let i = m.index + m[0].length;
    if (src[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '"' || ch === "'" || ch === "`") {
          // пропускаем строковый литерал целиком
          const quote = ch;
          i++;
          while (i < src.length && src[i] !== quote) {
            if (src[i] === "\\") i++;
            i++;
          }
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      out.push(src.slice(start, i));
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++;
        j++;
      }
      out.push(src.slice(i, j + 1));
    }
  }
  return out;
}

/**
 * Удвоенные селекторы, которые не матчатся. Возвращает список.
 * Класс считается применённым дважды, только если он встречается два раза
 * ВНУТРИ ОДНОГО значения className (два разных className на одном узле
 * невозможны, а вот `{clsx(a, a)}` или `` `${a} ${a}` `` — вполне).
 */
function findDeadDoubled(): Dead[] {
  const tsxFiles = walkTsx(srcDir);
  // css-модуль -> [(tsx, alias локального импорта)]
  const consumers = new Map<string, [string, string][]>();
  for (const t of tsxFiles) {
    const s = read(t);
    for (const m of s.matchAll(
      /import\s+(\w+)\s+from\s+"(\.[^"]*\.module\.css)"/g,
    )) {
      const key = m[2]!.replace(/^\./, "").split("/").pop()!;
      const list = consumers.get(key) ?? [];
      list.push([t, m[1]!]);
      consumers.set(key, list);
    }
  }

  const dead: Dead[] = [];
  for (const cssFile of walkCss(srcDir)) {
    const code = stripComments(read(cssFile));
    const rel = cssFile.slice(srcDir.length + 1);
    const users = consumers.get(basename(cssFile)) ?? [];
    // Удвоение в любом контексте селектора: `.X.X`, `.X.X > y`, `.X.X.y`.
    // Прежний вариант требовал запятую/фигурную скобку сразу после и
    // therefore пропускал compound-виды вроде `.cell.cell > :last-child`.
    const seenHere = new Set<string>();
    for (const m of code.matchAll(/\.([A-Za-z][\w-]*)\.\1(?![-\w])/g)) {
      const cls = m[1]!;
      if (seenHere.has(cls)) continue;
      seenHere.add(cls);
      let alive = false;
      for (const [file, alias] of users) {
        const s = read(file);
        for (const expr of classNameValues(s)) {
          const token = new RegExp(`\\b${alias}\\.${cls}\\b`, "g");
          if ((expr.match(token) ?? []).length >= 2) alive = true;
        }
      }
      if (!alive) dead.push({ file: rel, cls });
    }
  }
  return dead;
}

const key = (d: Dead): string => `${d.file}:${d.cls}`;

/**
 * Известный долг. Пополняется по мере разбора; строки не удаляются молча —
 * тест ниже падает, если запись перестала быть мёртвой.
 * Полный разбор: src/ui/README.md, «Известные мёртвые селекторы».
 */
const KNOWN_DEAD = new Set([
  "components/AppBottomBar/AppBottomBar.module.css:nav",
  "components/ReviewCard/ReviewCard.module.css:authorName",
  "components/Section/NextTripBanner.module.css:banner",
  "components/Section/TripSearchSection.module.css:searchCard",
  "components/Section/TripStandardCard.module.css:card",
  "components/Section/TripStandardCard.module.css:person",
  "components/Section/TripStandardCard.module.css:price",
  "components/Section/TripStandardCard.module.css:seats",
  "components/Trip/TripCards.module.css:cancelRight",
  "components/Trip/TripCards.module.css:footerEnd",
  "components/Trip/TripCards.module.css:requestCell",
  "components/Trip/TripCards.module.css:seat",
  "pages/CreateTrip/CreateTripPage.module.css:swap",
  "pages/Notifications/NotificationsPage.module.css:cell",
  "pages/Notifications/NotificationsPage.module.css:filter",
  "pages/Notifications/NotificationsPage.module.css:filterActive",
  "pages/Notifications/NotificationsPage.module.css:info",
  "pages/Search/SearchPage.module.css:chip",
  "pages/Search/SearchPage.module.css:swap",
  "pages/TripActive/TripActivePage.module.css:filter",
  "pages/TripActive/TripActivePage.module.css:filterActive",
  "pages/TripActive/TripActivePage.module.css:searchField",
  "pages/TripActive/TripActivePage.module.css:searchRow",
]);


describe("страж: удвоенные селекторы не должны быть мёртвыми", () => {
  const found = findDeadDoubled();
  const foundKeys = new Set(found.map(key));

  it("детектор вообще работает (находит известный мёртвый селектор)", () => {
    // Страховка от «тест зелёный, потому что регулярка сломалась».
    expect(found.length).toBeGreaterThan(5);
  });

  it("не появилось НОВЫХ мёртвых удвоенных селекторов", () => {
    const fresh = found.filter((d) => !KNOWN_DEAD.has(key(d)));
    expect(
      fresh.map(key),
      "новый мёртвый селектор: либо убери удвоение (`.X.X` → `.X`), либо " +
        "добавь в KNOWN_DEAD с разбором в ui/README.md",
    ).toEqual([]);
  });

  it("KNOWN_DEAD не устарел: перечисленные селекторы ещё мертвы", () => {
    const fixed = [...KNOWN_DEAD].filter((k) => !foundKeys.has(k));
    expect(
      fixed,
      "эти селекторы перестали быть мёртвыми — удали их из KNOWN_DEAD, " +
        "список должен точно отражать долг",
    ).toEqual([]);
  });

  it("ui.module.css: селектор .card одиночный (регрессия 2026-10-01)", () => {
    const code = stripComments(read(join(srcDir, "ui", "ui.module.css")));
    expect(code).not.toMatch(/\.card\s+\.card/);
  });

  it("все известные мёртвые живут в модулях, а не в ui/", () => {
    for (const k of KNOWN_DEAD) {
      expect(k.startsWith("ui" + sep), `${k} — ui/ чинится точечными тестами`).toBe(
        false,
      );
    }
  });
});
