// Проверка «Кто ищет попутку» на живом стенде: строка спроса — ИНФОРМАЦИЯ,
// а не ссылка. Клик и курсор проверяются в браузере, потому что в jsdom/SSR
// не вычисляются ни `cursor`, ни поведение :hover, а kit-овский `Cell` внутри
// всегда тянет `Tappable` (`cursor:pointer` + hover-подложка) независимо от
// `Component` — именно это и надо поймать.
//
// Паттерн — e2e/ui-cascade.mjs (тот же приём: читаем вычисленные стили
// вместо исходников CSS).
import { chromium } from "playwright";

const TG_BASE = process.env.TG_BASE_URL || "http://127.0.0.1:3012";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (e) =>
  pageErrors.push(String(e).split("\n")[0].slice(0, 160)),
);

await page.goto(TG_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Цель — корень клетки: в dev-сборке CSS-модулей имя класса читаемо
// (`_staticCell_<hash>`). Поиск по тексту подписи брал внешнюю обёртку
// секции, а не строку, и мерил не то.
const ROW = '[class*="staticCell"]';

const readRows = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="staticCell"]')];
    const row = rows[0] ?? null;
    if (!row) return { count: 0 };
    const cs = getComputedStyle(row);
    return {
      count: rows.length,
      tag: row.tagName,
      role: row.getAttribute("role"),
      tabIndex: row.getAttribute("tabindex"),
      cursor: cs.cursor,
      background: cs.backgroundColor,
      hasSvg: Boolean(row.querySelector("svg")),
      text: (row.textContent ?? "").slice(0, 60),
    };
  });

// Прокручиваем строку В ЦЕНТР вьюпорта, а не просто «в поле зрения»:
// фиксированный таббар закрывает нижние ~100px, и при `scrollIntoViewIfNeeded`
// центр строки оказывается под ним — hit-testing then measures не её (в
// прошлом прогоне это дало ложный «клик увёл на /trips»).
await page.evaluate((sel) => {
  document.querySelector(sel)?.scrollIntoView({ block: "center" });
}, ROW);
await page.waitForTimeout(250);

const before = await readRows();

let atPoint = null;
const urlBefore = page.url();
let hover = null;
if (before.count > 0) {
  await page.locator(ROW).first().hover({ force: true });
  await page.waitForTimeout(150);
  hover = await readRows();
  // `force: true` кликает по координатам и игнорирует hit-testing, поэтому
  // может попасть в элемент ПОД строкой. Сначала спрашиваем, что там лежит,
  // затем кликаем по самому узлу (без проверки попадания) — так проверяется
  // именно обработчик строки, а не то, что под ней.
  const hit = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const el = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return {
      pointTag: el?.tagName ?? null,
      pointIsRowOrInside: el ? row.contains(el) || el === row : false,
      pointClass: (el?.className || "").toString().slice(0, 60),
      pointText: (el?.textContent ?? "").slice(0, 40),
    };
  }, ROW);
  atPoint = hit;
  await page.evaluate((sel) => {
    document.querySelector(sel)?.click();
  }, ROW);
  await page.waitForTimeout(600);
}
const urlAfter = page.url();

const probe = { ...before, hover, atPoint, urlBefore, urlAfter, pageErrors };

console.log(
  JSON.stringify(probe, null, 2),
);

await browser.close();

const failures = [];
if (probe.count === 0) failures.push("не найдено ни одной строки спроса (класс staticCell)");
if (probe.tag !== "DIV") failures.push(`корень строки — <${probe.tag}>, а не div`);
if (probe.role !== null) failures.push(`у строки есть role=${probe.role}`);
if (probe.tabIndex !== null) failures.push(`у строки есть tabindex=${probe.tabIndex}`);
// `auto` и `default` означают одно и то же для div — «не указатель». Важно
// лишь, что НЕ pointer: его кит задаёт всегда, независимо от Component.
if (probe.cursor === "pointer") failures.push("курсор остался указателем");
if (hover && hover.cursor === "pointer") failures.push("курсор указателем и при наведении");
if (hover && hover.background !== probe.background)
  failures.push(
    `на наведении появилась подложка: ${probe.background} → ${hover.background}`,
  );
if (urlAfter !== urlBefore) failures.push(`клик увёл с ${urlBefore} на ${urlAfter}`);
// Если по центру строки лежит что-то другое, клик в этой точке не про нашу
// строку —hit-testing надо чинить, а не ругаться на строку.
if (atPoint && atPoint.pointIsRowOrInside === false)
  failures.push(
    `по центру строки лежит <${atPoint.pointTag}> «${atPoint.pointText}» — строка перекрыта или вне вьюпорта`,
  );
if (pageErrors.length) failures.push(`pageerror: ${pageErrors.join("; ")}`);

if (failures.length) {
  console.error("FAIL:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`OK: ${probe.count} статичных строк, курсор ${probe.cursor}, клик никуда не ведёт`);
