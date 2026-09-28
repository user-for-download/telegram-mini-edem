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
const tabbarCss = readCss("../components/TabsBar/Tabbar.module.css");

/** Тело правила по селектору (сопоставление точное, классы хэшированы). */
const ruleBody = (css: string, selector: string): string =>
  css.match(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  )?.[1] ?? "";

/** Все .ts/.tsx файлы приложения, кроме тестов. */
function walkSource(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walkSource(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
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
  it(".card.card задаёт полную ширину и border-box, но НЕ display", () => {
    const card = ruleBody(pageCss, ".card.card");
    expect(card).toContain("width: 100%");
    expect(card).toContain("box-sizing: border-box");
    // display перебил бы display:flex потребителя (равная сила селектора →
    // решает порядок инъекции модулей, а это не контракт). См. ui/README.md.
    expect(card).not.toContain("display:");
  });
});
