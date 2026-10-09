// UI-ритм E2E (Playwright + Chromium): замер рёбер экрана.
//
// ЗАЧЕМ. Рельс отступов задан централизованно: `ui/Page` (китовый `List`) с
// `.page { padding: var(--app-page-pad-top) var(--app-page-gutter)
// var(--app-page-pad-bottom) }`, токены — в `src/index.css`. Текстовый пин
// `layoutCss.test.ts` проверяет, что ПРАВИЛО написано верно, но не проверяет
// два things, которые ломают вид тихо:
//
//   1. правило не доехало до узла (класс не в DOM) — тогда у экрана паддинг
//      кита (iOS `10px 18px`) вместо нашего, и экран «поехал»;
//   2. кто-то добавил корню экрана СВОЙ отступ (обёртка, локальный класс,
//      второй Page) — по исходнику это видно только глазами, а в рантайме
//      на конкретном маршруте рёбра уже другие.
//
// Что меряем (по каждому маршруту в scope):
//   - computed padding корня `.page` — главная величина;
//   - фактические рёбра: левый/правый инсет ПЕРВОГО видимого блока от колонки
//     приложения, верхний зазор от низа шапки;
//   - нижний зазор последнего блока до дока таббара на докрученной странице
//     (контент не должен уходить под док).
//
// Эталон берётся с первого маршрута в ROUTES и сверяется с ТОКЕНАМИ, а не
// только «все одинаковые»: иначе общее отклонение (уехавший на 8px вниз
// гуттер) прошло бы как «все одинаковы».
//
// ВНЕ scope (осознанные исключения, см. README): hero-экраны
// (`Page variant="hero"` — онбординг, AuthGate, loading/error создания
// поездки): низа таббара нет, низ `--app-page-pad-bottom-hero`, центрирование
// auto-полями. Шторки (`/trips/:id`, `/profile/edit`, `/settings`, `/vehicle`,
// `/trips/my/:id/requests`): контент внутри SheetBody, геометрия модальная.
// Терминальные экраны (`AccountStatePage`): свой колоночный бокс `.root` с
// `env(safe-area)` внутри Page. `EnvUnsupported`: рендерится ВНЕ AppRoot.
//
// Prerequisites (см. e2e/README.md):
// - Telegram dev-сервер: pm2 edem-dev-frontend (TG_BASE, default :3012)
// - Backend: pm2 edem-dev-backend (с ALLOW_DEV_AUTH=true и dev DB)
//
// Env:
// - TG_BASE_URL (default http://localhost:3012)
// - E2E_VERBOSE=1 — подробные замеры по каждому маршруту.
import { chromium } from "playwright";
import { checkPrereqs, reviveDevUser } from "./telegram-fixtures.mjs";

checkPrereqs();
reviveDevUser();

const TG_BASE = process.env.TG_BASE_URL || "http://localhost:3012";
const VERBOSE = process.env.E2E_VERBOSE === "1";

/**
 * Маршруты в scope: корневые табы + подстраницы профиля.
 * Порядок значим — первый маршрут задаёт эталон рёбер.
 */
const ROUTES = [
  { path: "/", name: "Главная" },
  { path: "/trips", name: "Поиск" },
  { path: "/bookings", name: "Поездки" },
  { path: "/notifications", name: "Уведомления" },
  { path: "/profile", name: "Профиль" },
  { path: "/profile/history", name: "История поездок" },
  { path: "/profile/ride-requests", name: "История запросов" },
  { path: "/reviews", name: "Отзывы" },
  { path: "/profile/support", name: "Поддержка" },
  { path: "/profile/reports", name: "Мои обращения" },
  { path: "/trips/my/new", name: "Создание поездки" },
];

/** Допуск в px на сравнение дробных значений (safe-area бывает дробной). */
const EPS = 0.5;

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`,
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0].slice(0, 160)));

/**
 * Замер одного экрана. Выполняется целиком в браузере: rect'ы и computed
 * styles — их нельзя вычислить на стороне Node.
 */
async function measure() {
  return page.evaluate(() => {
    const num = (value) => Math.round(Number.parseFloat(value) * 100) / 100;

    // Корень экрана — единственный узел с нашим классом `.page`
    // (китовский List). Ищем по классу: он хэшируется сборкой, но
    // `page`/`pageHero` определены только в ui/ui.module.css, поэтому
    // селектор не ловит чужой модуль.
    const root =
      document.querySelector("[class*='_page_']") ||
      document.querySelector("[class*='_pageHero_']");
    if (!root) return { missing: true };

    const cs = getComputedStyle(root);
    const tokens = getComputedStyle(document.documentElement);
    const px = (name) => num(tokens.getPropertyValue(name));

    // Колонка приложения — родитель `main[data-shell-content]`; её границы
    // и есть «края экрана», к которым привязан рельс.
    const shell = document.querySelector("[data-shell-content]")?.parentElement;
    const shellRect = shell?.getBoundingClientRect();
    const headerRect = document
      .querySelector("[class*='_bar_']")
      ?.getBoundingClientRect();
    const dock = document.querySelector("[class*='tabbar']");
    const dockRect = dock?.getBoundingClientRect();

    // Первый/последний ВИДИМЫЙ блок: у корня часто первым идёт
    // VisuallyHidden h1 (1×1, absolute) — он не задаёт видимый край.
    // Храним ЭЛЕМЕНТ (нужен для getComputedStyle), rect считаем отдельно.
    const visibleEls = [...root.children].filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return !(
        r.width === 0 ||
        r.height === 0 ||
        style.position === "absolute" ||
        style.visibility === "hidden"
      );
    });

    const firstEl = visibleEls[0] ?? null;
    const lastEl = visibleEls[visibleEls.length - 1] ?? null;
    const first = firstEl?.getBoundingClientRect() ?? null;
    const last = lastEl?.getBoundingClientRect() ?? null;

    // Рамка колонки: 1px-бордер AppShell лежит ВНЕ рельса, поэтому инсет
    // первого блока от ГРАНИЦЫ колонки на 1px больше гуттера. Считаем от
    // внутреннего края (content box) — иначе сравнение всегда врёт на 1px.
    const shellCs = shell ? getComputedStyle(shell) : null;
    const borderLeft = shellCs ? num(shellCs.borderLeftWidth) : 0;
    const borderRight = shellCs ? num(shellCs.borderRightWidth) : 0;

    return {
      missing: false,
      rootTag: root.tagName.toLowerCase(),
      rootClass: String(root.className),
      pad: {
        top: num(cs.paddingTop),
        left: num(cs.paddingLeft),
        right: num(cs.paddingRight),
        bottom: num(cs.paddingBottom),
      },
      tokens: {
        padTop: px("--app-page-pad-top"),
        gutter: px("--app-page-gutter"),
        dockHeight: px("--app-dock-height"),
        dockFloat: px("--app-dock-float"),
        pageGap: px("--app-page-gap"),
        dockGap: px("--app-dock-gap"),
        // --app-safe-bottom = max(env(...), var(...)): браузер отдаёт
        // выражение НЕвычисленным, поэтому парсинг даёт NaN → это 0 в
        // обычном WebView, и такой ноль и подставляем в формулу.
        safeBottom: Number.isNaN(px("--app-safe-bottom")) ? 0 : px("--app-safe-bottom"),
      },
      edges: {
        shellLeft: shellRect ? num(shellRect.left) : null,
        shellRight: shellRect ? num(shellRect.right) : null,
        borderLeft,
        borderRight,
        // Инсеты ПЕРВОГО блока от внутреннего края колонки: так виден
        // реальный гуттер, а не задекларированный паддинг корня.
        firstLeft: first ? num(first.left - shellRect.left - borderLeft) : null,
        firstRight: first ? num(shellRect.right - first.right - borderRight) : null,
        // Верхний зазор от низа шапки до рамки первого блока.
        // ВНИМАНИЕ: рамка ≠ текст. У китовой Cell есть собственный верхний
        // паддинг, а ProfileSection на Главной добавляет margin-top: 6px
        // (документированная оптическая доводка — см. ProfileSection.module.css),
        // поэтому рамка там на 10px, а строка текста на 20px — как на
        // страницах-карточках. Метрика информационная, контракт — `pad.top`.
        topGap: first && headerRect ? num(first.top - headerRect.bottom) : null,
        // Верхний отступ САМОГО блока: сумма margin-top и padding-top — вот
        // это и есть «верх экрана» для глаза, сопоставимое между страницами.
        firstContentTop:
          first && headerRect && firstEl
            ? num(
                first.top -
                  headerRect.bottom -
                  parseFloat(getComputedStyle(firstEl).marginTop) -
                  parseFloat(getComputedStyle(firstEl).paddingTop),
              )
            : null,
        // Нижний зазор последнего блока до верха дока (страница докручена).
        bottomGap: last && dockRect ? num(dockRect.top - last.bottom) : null,
        firstWidth: first ? num(first.width) : null,
      },
    };
  });
}

const measurements = [];

// Хеш-роутер: смена маршрута = смена location.hash БЕЗ перезагрузки,
// поэтому первый goto грузит приложение, дальше меняем hash и ждём контент.
await page.goto(`${TG_BASE}/#${ROUTES[0].path}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Нижний зазор измеряем ОТДЕЛЬНО и только на докрученной странице: пока
// сверху, последний блок где-то под экраном и зазор до дока всегда
  // отрицательный. Верхние рёбра — наоборот, только вверху страницы.
  async function measureBottom() {
    return page.evaluate(() => {
      const root = document.querySelector("[class*='_page_']");
      const dock = document.querySelector("[class*='tabbar']");
      if (!root || !dock) return null;
      const dockRect = dock.getBoundingClientRect();
      const last = [...root.children]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width !== 0 && r.height !== 0 && s.position !== "absolute" && s.visibility !== "hidden";
        })
        .pop();
      if (!last) return null;
      return Math.round((dockRect.top - last.getBoundingClientRect().bottom) * 100) / 100;
    });
  }

for (const route of ROUTES) {
  await page.evaluate((path) => {
    window.location.hash = `#${path}`;
  }, route.path);
  // Ждём смену маршрута: ключ route-fade = pathname, поэтому контент
  // перемонтируется и первый экран успевает отрисоваться.
  await page.waitForTimeout(1200);

  const data = await measure();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  data.edges.bottomGap = await measureBottom();
  measurements.push({ ...route, ...data });

  if (data.missing) {
    record(`${route.name} (${route.path}): корень экрана найден`, false, "нет узла .page");
    continue;
  }
  if (VERBOSE) {
    console.log(`\n— ${route.name} ${route.path}`);
    console.log(`  root ${data.rootTag}.${data.rootClass}`);
    console.log(`  padding ${data.pad.top}/${data.pad.left}/${data.pad.right}/${data.pad.bottom}`);
    console.log(`  edges  ${JSON.stringify(data.edges)}`);
  }
}

// ── Эталон: рельс с первого маршрута ────────────────────────────────────────
const ref = measurements.find((m) => !m.missing);
const fmt = (pad) => `${pad.top}/${pad.left}/${pad.right}/${pad.bottom}`;

record(
  "эталон рёбер снят (Главная)",
  Boolean(ref),
  ref ? `padding ${fmt(ref.pad)}` : "корень не найден ни на одном маршруте",
);

// ── Проверка 1: рёбра ОДИНАКОВЫ на всех маршрутах ───────────────────────────
for (const m of measurements) {
  if (m.missing) continue;
  const same =
    Math.abs(m.pad.top - ref.pad.top) <= EPS &&
    Math.abs(m.pad.left - ref.pad.left) <= EPS &&
    Math.abs(m.pad.right - ref.pad.right) <= EPS &&
    Math.abs(m.pad.bottom - ref.pad.bottom) <= EPS;
  record(
    `${m.name} (${m.path}): рёбра корня = эталон`,
    same,
    same ? fmt(m.pad) : `${fmt(m.pad)} ≠ эталон ${fmt(ref.pad)}`,
  );
}

// ── Проверка 2: эталон совпадает с ТОКЕНАМИ ────────────────────────────────
// Все одинаковые, но уехавшие на 8px — не «одинаково», а «одинаково неверно».
const t = ref?.tokens ?? {};
// Низ — формула индекса (index.css --app-page-pad-bottom): док + отрыв +
// визуальный зазор + max(safe-bottom, dock-gap).
const expectedBottom =
  (t.dockHeight ?? 0) + (t.dockFloat ?? 0) + (t.pageGap ?? 0) + Math.max(t.safeBottom ?? 0, t.dockGap ?? 0);

record(
  "верх экрана = --app-page-pad-top (4px)",
  Math.abs(ref?.pad.top - (t.padTop ?? -1)) <= EPS,
  `${ref?.pad.top}px`,
);
record(
  "бока экрана = --app-page-gutter (16px) и симметричны",
  Math.abs((ref?.pad.left ?? 0) - (t.gutter ?? -1)) <= EPS &&
    Math.abs((ref?.pad.right ?? 0) - (t.gutter ?? -1)) <= EPS,
  `${ref?.pad.left}/${ref?.pad.right}px`,
);
record(
  "низ экрана = док + отрыв + зазор + safe-area",
  Math.abs((ref?.pad.bottom ?? 0) - expectedBottom) <= EPS,
  `${ref?.pad.bottom}px (ожидалось ${expectedBottom}px)`,
);

// ── Проверка 3: ФАКТИЧЕСКИЕ рёбра (не только декларация паддинга) ───────────
// Паддинг корня может быть верным, а первый блок — уехавшим (обёртка с
// своим отступом), поэтому сверяем ещё и геометрию в пикселях.
for (const m of measurements) {
  if (m.missing || !m.edges.firstLeft) continue;
  const e = m.edges;
  const edgesOk =
    Math.abs(e.firstLeft - ref.pad.left) <= EPS &&
    Math.abs(e.firstRight - ref.pad.right) <= EPS;
  record(
    `${m.name}: фактические бока первого блока = гуттер`,
    edgesOk,
    edgesOk ? `${e.firstLeft}/${e.firstRight}px` : `${e.firstLeft}/${e.firstRight}px ≠ ${ref.pad.left}/${ref.pad.right}px`,
  );
}

// Верх НЕ сравниваем по отступу содержимого первого блока: он зависит от
// внутреннего паддинга компонента (у карточек — 16px тела секции, у строки
// профиля — `margin-top: 6px` оптической доводки, см. ProfileSection.module.css),
// то есть это свойство компонента, а не рельса экрана. Контракт верхней
// границы — сам `pad.top`, он проверен выше и одинаков на всех маршрутах.
// Значение остаётся в таблице как справочное.

for (const m of measurements) {
  if (m.missing || m.edges.bottomGap === null) continue;
  // Контент не должен уходить под док таббара.
  record(
    `${m.name}: контент не уходит под док`,
    m.edges.bottomGap >= 0,
    `зазор ${m.edges.bottomGap}px`,
  );
}

await browser.close();

record("нет pageerror при обходе", pageErrors.length === 0, pageErrors.join(" | "));

const failed = results.filter((r) => !r.ok);

// Итоговая таблица рёбер — читаемый отчёт, а не только список падений.
console.log("\nРёбра экранов (padding корня / факт боков / верх контента / низ до дока):");
console.log("экран                     padding      бока   верх*  низ");
for (const m of measurements) {
  if (m.missing) {
    console.log(`${m.name.padEnd(24)} НЕТ КОРНЯ`);
    continue;
  }
  const e = m.edges;
  console.log(
    `${m.name.padEnd(24)} ${fmt(m.pad).padEnd(13)} ${`${e.firstLeft}/${e.firstRight}`.padEnd(6)} ${String(e.firstContentTop).padEnd(5)} ${e.bottomGap}`,
  );
}

console.log(
  `\n${results.length - failed.length}/${results.length} проверок ритма прошли` +
    (failed.length ? `, ПРОВАЛЕНО: ${failed.map((f) => f.name).join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);
