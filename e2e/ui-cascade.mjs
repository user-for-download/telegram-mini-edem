// UI-каскад E2E (Playwright + Chromium): замер getComputedStyle.
//
// Закрывает пробел, который не закрывают vitest-тесты: они читают ТЕКСТ
// CSS, поэтому не видят, применилось ли правило в браузере. Именно этим
// были сломаны 26 правил (`.card.card`, `.snackbar.snackbar`,
// `.tabbar.tabbar` и др.): правила корректно выглядели в исходнике, паин
// на них был зелёным, а в рантайме не срабатывало ни одно.
//
// Проверяется:
// 1. карточка: radius 16 (не 20 кита) и фон = --tg-theme-section-bg-color
//    Telegram, а не литерал tertiary_bg_color кита;
// 2. карточка на всю ширину родителя (width:100% из ui.module.css);
// 3. док таббара — парящая пилюля: radius 32, bottom, полупрозрачный фон
//    (color-mix), а не полоса во всю ширину;
// 4. ни одного pageerror на экране.
//
// Prerequisites (см. e2e/README.md):
// - Telegram dev-сервер: pm2 edem-dev-frontend (TG_BASE, default :3012)
// - Backend: pm2 edem-dev-backend (с ALLOW_DEV_AUTH=true и dev DB)
//
// Env:
// - TG_BASE_URL (default http://localhost:3012)
// - E2E_VERBOSE=1 — подробные логи.
import { chromium } from "playwright";
import { checkPrereqs, reviveDevUser } from "./telegram-fixtures.mjs";

// Стенд готовим сами: каскад меряет интерфейс, и без живой главной страницы
// он падает не по делу (при onboardingVersion = NULL приложение показывает
// экран первого входа — «нет карточек», 1/6). Раньше ремонт дев-юзера жил
// только в teardown-е telegram-parity, сюда не доходил.
checkPrereqs();
reviveDevUser();

const TG_BASE = process.env.TG_BASE_URL || "http://localhost:3012";
const VERBOSE = process.env.E2E_VERBOSE === "1";

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

async function step(name, fn) {
  try {
    record(name, true, (await fn()) ?? "");
  } catch (e) {
    record(name, false, String(e.message || e).split("\n")[0].slice(0, 240));
  }
}

/** rgb(r,g,b) → [r,g,b] для сравнения с токеном. */
const toRgb = (value) => {
  const m = (value || "").match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : null;
};
const sameRgb = (a, b) => JSON.stringify(toRgb(a)) === JSON.stringify(toRgb(b));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0].slice(0, 160)));

await page.goto(TG_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const probe = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const card = document.querySelector("article");
  const tabbar = document.querySelector("[class*='tabbar']");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const cardCs = cs(card);
  const tabCs = cs(tabbar);
  return {
    hasCard: Boolean(card),
    hasTabbar: Boolean(tabbar),
    cardRadius: cardCs?.borderRadius ?? null,
    cardBg: cardCs?.backgroundColor ?? null,
    cardShadow: cardCs?.boxShadow ?? null,
    cardDisplay: cardCs?.display ?? null,
    cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
    cardParentWidth: card
      ? Math.round(card.parentElement.getBoundingClientRect().width)
      : null,
    sectionBgToken: root
      .getPropertyValue("--tg-theme-section-bg-color")
      .trim(),
    tabRadius: tabCs?.borderRadius ?? null,
    tabPosition: tabCs?.position ?? null,
    tabBottom: tabCs?.bottom ?? null,
    tabBg: tabCs?.backgroundColor ?? null,
    tabWidth: tabbar
      ? Math.round(tabbar.getBoundingClientRect().width)
      : null,
    matchedSurface: (() => {
      // Правило, задающее нашу поверхность, узнаём по токену радиуса:
      // иначе любое другое правило (кит, потребитель) выдаст себя за него.
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!rule.selectorText || !rule.style) continue;
          let matches = false;
          try {
            matches = card.matches(rule.selectorText);
          } catch {
            /* невалидный селектор */
          }
          if (!matches) continue;
          const radius = rule.style.getPropertyValue("border-radius");
          if (!radius.includes("--app-card-radius")) continue;
          return {
            selector: rule.selectorText.slice(0, 90),
            hasRadiusToken: true,
            width: rule.style.getPropertyValue("width").trim(),
            boxSizing: rule.style.getPropertyValue("box-sizing").trim(),
            declaresDisplay: Boolean(rule.style.getPropertyValue("display").trim()),
          };
        }
      }
      return null;
    })(),
    tabParentWidth: tabbar
      ? Math.round(tabbar.parentElement.getBoundingClientRect().width)
      : null,
  };
});

if (VERBOSE) console.log("probe:", JSON.stringify(probe, null, 2));

await step("карточка отрендерена (ui/Card)", () => {
  if (!probe.hasCard) throw new Error("нет <article> — карточек на экране нет");
  return `${probe.cardWidth}px`;
});

await step("card radius = 16px (реестр #3, не 20 кита)", () => {
  if (probe.cardRadius !== "16px")
    throw new Error(`получено ${probe.cardRadius}, ожидалось 16px`);
  return probe.cardRadius;
});

await step("card фон = --tg-theme-section-bg-color, а не литерал кита", () => {
  if (!probe.sectionBgToken)
    throw new Error("Telegram не отдал --tg-theme-section-bg-color");
  // Токен приходит как #rrggbb, computed — как rgb(): сравниваем каналы.
  const hex = probe.sectionBgToken.trim();
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`не разобрал токен ${hex}`);
  const expected = `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
  if (!sameRgb(probe.cardBg, expected))
    throw new Error(
      `фон карточки ${probe.cardBg} ≠ тема ${expected} ` +
        `(литерал кита был бы rgb(244,244,247)/rgb(42,42,42))`,
    );
  return `${probe.cardBg} = тема`;
});

// Реестр #4: гарантия «карточка всегда во всю ширину родителя». Проверять
// `width === parentWidth` БЕСПОЛЕЗНО: на экране поиска ту же полную ширину
// даёт `display: block` потребителя (TripSearchSection.searchCard), и проверка
// проходит даже без нашего правила. Проверяем поэтому то, что относится
// только к нему: НАШЕ правило (узнаём его по `var(--app-card-radius)`)
// реально применяется к узлу и объявляет width + box-sizing.
await step("правило поверхности карточки применяется и объявляет бокс", () => {
  const surface = probe.matchedSurface;
  if (!surface) throw new Error("поверхность карточки никем не задаётся");
  if (!surface.hasRadiusToken)
    throw new Error(`нет нашего правила: ${surface.selector}`);
  if (!surface.width) throw new Error("наше правило не объявляет width");
  if (!surface.boxSizing)
    throw new Error("наше правило не объявляет box-sizing: border-box");
  if (surface.declaresDisplay)
    throw new Error("наше правило объявляет display — оно перебьёт раскладку потребителя");
  return surface.selector.slice(0, 40);
});

await step("док таббара — парящая пилюля (radius 32, fixed, полупрозрачный)", () => {
  if (!probe.hasTabbar) throw new Error("нет дока таббара");
  if (probe.tabRadius !== "32px")
    throw new Error(`radius=${probe.tabRadius}, ожидался 32px`);
  if (probe.tabPosition !== "fixed")
    throw new Error(`position=${probe.tabPosition}`);
  // color-mix с transparent → alpha < 1. Если правило мертво, фон был бы
  // сплошным (alpha = 1) от китового surface_primary.
  const alpha = Number((probe.tabBg || "").match(/[\d.]+\)$/)?.[0]?.slice(0, -1) ?? "1");
  if (!(alpha < 1)) throw new Error(`фон дока непрозрачный: ${probe.tabBg}`);
  if (probe.tabWidth >= probe.tabParentWidth)
    throw new Error(
      `док ${probe.tabWidth}px во всю ширину родителя ${probe.tabParentWidth}px — пилюли нет`,
    );
  return `r=${probe.tabRadius} bottom=${probe.tabBottom} α=${alpha} w=${probe.tabWidth}/${probe.tabParentWidth}`;
});

await step("нет pageerror на экране", () => {
  if (pageErrors.length) throw new Error(pageErrors.join(" | "));
  return "";
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} проверок каскада прошли` +
    (failed.length ? `, ПРОВАЛЕНО: ${failed.map((f) => f.name).join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);
