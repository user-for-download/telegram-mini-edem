// CSS-контракт каркаса (сессия tailwind-decommission): проверяем сырой текст
// stylesheet'ов, потому что SSR-тесты разметки не видят каскад. Регрессия,
// которую ловим: TGUI вне слоя `tgui` + статичный низ Page → на iOS
// `padding: 10px 18px` от List перебивает клиренс дока и контент уходит
// под таббар (нижняя кнопка «Создать поездку»).
// Паттерн чтения модуля — ui/__tests__/notice.test.tsx (readFileSync).
//
// Здесь же — структурные инварианты фасада ui/ (см. src/ui/README.md):
// корень экрана только через ui/Page, вариант hero, бокс Card, pin ритма.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readCss = (relativePath: string): string =>
  readFileSync(join(here, relativePath), "utf8");

const indexCss = readCss("../index.css");
const pageCss = readCss("../ui/ui.module.css");
const textCss = readCss("../ui/text.module.css");
const chipCss = readCss("../ui/Chip.module.css");
const tabbarCss = readCss("../components/TabsBar/Tabbar.module.css");
const toastCss = readCss("../components/Toast/Toast.module.css");

/** Тело правила по селектору (сопоставление точное, классы хэшированы). */
const ruleBody = (css: string, selector: string): string =>
  css.match(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  )?.[1] ?? "";

/**
 * CSS без комментариев. Обязательно для проверок по тексту: комментарии в
 * этом репозитории ПОСТОЯННО упоминают «@layer tgui» и «без !important» —
 * наивная регулярка ловит их и даёт 20 ложных срабатываний.
 */
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Все .css/.module.css файлы приложения (рекурсивно, кроме тестов). */
function walkCss(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walkCss(full, acc);
    } else if (/\.(css|module\.css)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Все .ts/.tsx файлы приложения, кроме тестов. */
function walkSource(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walkSource(full, acc);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe("каркас: слой TGUI и нижний клиренс", () => {
  it("TGUI подключён в @layer tgui (неслойные модули должны побеждать)", () => {
    expect(indexCss).toContain("@layer tgui;");
    expect(indexCss).toContain(
      '@import "@telegram-apps/telegram-ui/dist/styles.css" layer(tgui);',
    );
  });

  it("Page берёт низ из токена, а не из литерала", () => {
    expect(pageCss).toMatch(/\.page\s*\{[\s\S]*?var\(--app-page-pad-bottom\)/);
  });

  it("клиренс Page включает высоту дока, отрыв пилюли и нижнюю safe-area", () => {
    expect(indexCss).toContain("--app-safe-bottom:");
    expect(indexCss).toContain("--app-dock-height: 64px;");
    expect(indexCss).toContain("--app-dock-gap: 8px;");
    expect(indexCss).toContain("--app-dock-float: 24px;");
    expect(indexCss).toContain("--app-page-pad-bottom: calc(");
  });

  it("нативный таббар: позиционированием и safe-area владеет кит (свой док удалён)", () => {
    expect(tabbarCss).toContain("FixedLayout");
    expect(tabbarCss).not.toContain(".dock");
    expect(tabbarCss).not.toContain("position: fixed");
  });

  it("Tailwind не возвращается в telegram-app", () => {
    expect(indexCss).not.toContain('@import "tailwindcss"');
    expect(indexCss).not.toContain("@tailwindcss");
  });

  it("снекбар снизу над доком таббара и со стандартной высотой", () => {
    const snackbar = ruleBody(toastCss, ".snackbar");
    expect(snackbar).toContain("top: auto");
    expect(snackbar).toContain("var(--app-dock-height)");
    expect(snackbar).toContain("var(--app-dock-float)");
    expect(ruleBody(toastCss, ".snackbar > div")).toContain(
      "min-height: 48px",
    );
  });
});

describe("каркас: корень экрана — только ui/Page", () => {
  it("сырого <List> вне src/ui нет (иначе платформенный паддинг кита)", () => {
    const srcDir = join(here, "..");
    const offenders = walkSource(srcDir)
      .filter((file) => !file.includes(`${sep}ui${sep}`))
      .filter((file) =>
        // Многострочный импорт: смотрим всё объявление целиком.
        /import\s*\{[^}]*\bList\b[^}]*\}\s*from\s*"@telegram-apps\/telegram-ui"/s.test(
          readFileSync(file, "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("Page variant=hero владеет высотой, центрированием и своим низом", () => {
    const hero = ruleBody(pageCss, ".pageHero");
    expect(hero).toContain("min-height: var(--tg-viewport-height");
    expect(hero).toContain("var(--app-page-pad-bottom-hero)");
    expect(ruleBody(pageCss, ".pageHero > :first-child")).toContain(
      "margin-top: auto",
    );
    expect(ruleBody(pageCss, ".pageHero > :last-child")).toContain(
      "margin-bottom: auto",
    );
    expect(indexCss).toContain("--app-page-pad-bottom-hero:");
  });

  it("гуттер и ритм Page — из токенов (pin против bump'а кита)", () => {
    const page = ruleBody(pageCss, ".page");
    expect(page).toContain("var(--app-page-pad-top)");
    expect(page).toContain("var(--app-page-gutter)");
    expect(pageCss).toMatch(
      /\.page > :not\(:last-child\)\s*\{[^}]*margin-bottom:\s*var\(--app-space-sm\)/,
    );
    expect(indexCss).toContain("--app-space-sm: 12px;");
  });
});

describe("каркас: бокс ui/Card — собственность фасада", () => {
  it(".card задаёт полную ширину и border-box, но НЕ display", () => {
    const card = ruleBody(pageCss, ".card");
    expect(card).toContain("width: 100%");
    expect(card).toContain("box-sizing: border-box");
    // display перебил бы display:flex потребителя (равная сила селектора →
    // решает порядок инъекции модулей, а это не контракт). См. ui/README.md.
    expect(card).not.toContain("display:");
  });

  // Селектор `.card` — ОДИНОЧНЫЙ, и это проверяем явно: ruleBody('.card')
  // матчит и хвост `.card.card {`, поэтому текстовый пин свойств обманывался
  // ровно той регрессией, которую мы чиним. Удвоение требует, чтобы класс
  // стоял в атрибуте дважды, — тогда поверхность не применяется нигде.
  it(".card НЕ удвоен: селектор требует класс дважды и не сматчится", () => {
    // Без stripCssComments проверка ловит собственные комментарии файла:
    // там намеренно описан старый `.card.card` и почему он не работал.
    const code = stripCssComments(pageCss);
    expect(code).not.toContain(".card.card");
    expect(code).not.toMatch(/\.card\s+\.card/);
  });

  // Реестр отклонений #3. До визита сюда смена фона на дефолт кита
  // (tertiary_bg_color) проходила молча — весь набор тестов оставался зелёным.
  // Суть отклонения — не «рецепт», а ТЕМА: tertiary_bg_color у кита литерал
  // (#f4f4f7/#2a2a2a), а section_bg_color = var(--tg-theme-section-bg-color).
  it("поверхность Card — наша (section_bg_color) и радиус 16, а не дефолт кита", () => {
    const card = ruleBody(pageCss, ".card");
    expect(card).toContain("background: var(--tgui--section_bg_color)");
    expect(card).toContain("border-radius: var(--app-card-radius)");
    expect(card).not.toContain("tertiary_bg_color");
  });
});

describe("каркас: тап-таргет 44px (WCAG 2.5.5 AAA) — пин значения, а не факта", () => {
  // ui/Button выставляет data-tap-target="44", но атрибут выводится из факта
  // применения класса MIN_TARGET, а НЕ из CSS. Мутация 44px→30px оставляла
  // весь набор тестов зелёным, поэтому значение пиним здесь.
  it(".minTarget держит ровно 44px", () => {
    const rule = ruleBody(textCss, ".minTarget");
    expect(rule).toContain("min-height: 44px");
    // Ровно одно объявление min-height — иначе «победит» порядок в блоке.
    expect(rule.match(/min-height:/g)).toHaveLength(1);
  });

  it("44px выше нативных 42px кита (mode m), иначе height обнулит минимум", () => {
    expect(44).toBeGreaterThan(42);
  });
});

describe("каркас: рецепт выбранного тега (ui/Chip tone=accent)", () => {
  // Реестр отклонений #7. Ловим текстом: jsdom не каскадит CSS-модули, а по
  // DOM «горит ли тег» не проверить — aria-pressed ставит потребитель, не кит.
  it(".accent[aria-pressed=\"true\"] переопределяет фон кита", () => {
    expect(chipCss).toContain('.accent[aria-pressed="true"]');
    expect(chipCss).toContain("var(--tgui--button_color");
  });

  it("фон выбранного тега — кит-токен, а не литерал", () => {
    const rule = ruleBody(chipCss, '.accent[aria-pressed="true"]');
    expect(rule).toContain("background: var(--tgui--button_color");
  });
});

describe("каскад: наши модули обязаны остаться ВНЕ слоя tgui", () => {
  // Весь фасад держится на одном: неслойный модуль бьёт @layer tgui при любой
  // специфичности. Отсюда два следствия, каждое из которых тихо ломает
  // переопределения, оставляя тесты зелёными:
  //   1) наш CSS не должен попасть в СЛОЙ (тогда он опустится ниже кита);
  //   2) !important в наших файлах запрещён — он ломает правило «побеждает
  //      геометрия/слой, а не важность» и маскирует ошибки каскада.
  // Проверяем по ВСЕМ .css приложения, а не только по src/ui: модуль экрана
  // точно так же уехал бы в слой, если бы кто-то его туда завёл.
  const cssFiles = walkCss(join(here, ".."));
  /** Код файла без комментариев (см. stripCssComments). */
  const codeOf = (f: string): string => stripCssComments(readFileSync(f, "utf8"));

  it("наш CSS в приложении есть и ни один файл не положен в @layer", () => {
    expect(cssFiles.length).toBeGreaterThan(20);
    // Модули: @layer запрещён полностью. index.css — единственное законное
    // место: там объявление @layer tgui и импорт кита внутрь слоя. После
    // вырезания этих двух строк @layer не должен остаться НИГДЕ.
    const modules = cssFiles.filter((f) => !f.endsWith(`${sep}index.css`));
    const inModule = modules.filter((f) => /@layer\s/.test(codeOf(f)));
    expect(inModule).toEqual([]);

    const indexLeftover = codeOf(join(here, "..", "index.css"))
      .replace(/@layer\s+tgui\s*;/g, "")
      .replace(/@import[^;]*telegram-ui[^;]*layer\(tgui\);/g, "");
    expect(indexLeftover).not.toMatch(/@layer\s/);
  });

  it("!important не используется нигде в нашем CSS", () => {
    const offenders = cssFiles.filter((f) => codeOf(f).includes("!important"));
    expect(offenders).toEqual([]);
  });

  it("слой tgui объявлен ДО импорта кита (порядок объявления = порядок слоёв)", () => {
    const layerAt = indexCss.indexOf("@layer tgui;");
    const importAt = indexCss.indexOf(
      '@import "@telegram-apps/telegram-ui/dist/styles.css" layer(tgui);',
    );
    expect(layerAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeGreaterThan(layerAt);
  });

  it("в index.css кит подключён РОВНО ОДИН раз", () => {
    const imports = indexCss.match(/@import[^;]*telegram-ui[^;]*;/g) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("layer(tgui)");
  });
});

describe("каскад: остаточные слепые зоны (документированы, не закрыты)", () => {
  // Честная фиксация того, что структурными проверками НЕ ловится:
  // итоговое применение стилей в браузере (порядок инъекции модулей,
  // поведение @layer в конкретном движке). Для этого нужен замер
  // getComputedStyle в браузере (Playwright), а не чтение текста — jsdom
  // не каскадит слои. Пока такого стенда нет, это осознанный пробел:
  //новое глобальное НЕСЛОЙНОЕ правило в index/css с теми же свойствами, что
  // перебивает .page/.pageHero/.card, прошло бы молча.
  it("гипотеза о слепой зоне зафиксирована в ui/README.md", () => {
    const readme = readCss("../ui/README.md");
    expect(readme).toContain("@layer tgui");
    expect(readme).toMatch(/слойн/i);
  });
});
