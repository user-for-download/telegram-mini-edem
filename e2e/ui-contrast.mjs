// Контраст текста E2E (Playwright + Chromium): WCAG по ФАКТИЧЕСКОМУ
// вычисленному цвету.
//
// Закрывает тот же пробел, что и ui-cascade.mjs, но для контраста. vitest
// здесь бессилен по двум причинам:
//   1) jsdom не резолвит каскадный `color-mix(in srgb, …)`, поэтому
//      вычисленный цвет недоступен в Node;
//   2) значения --tgui--* принадлежат киту — копировать их в тест значит
//      завести второй источник правды (конвенция MEMORY §18).
// Поэтому числовая граница живёт здесь, в браузере, а в vitest остаётся
// СТРУКТУРНЫЙ пин (ui/__tests__/fieldLabelTone.test.tsx): токен объявлен в
// обеих темах, смешивается к правильному токену, процент не ниже минимума.
//
// ПОЧЕМУ «ХУДШИЙ ФОН», А НЕ ФОН СЕКЦИИ. Для тёмного текста худшая
// подложка — не белая, а самая тёмная из светлых поверхностей; для
// светлого — не #17212b, а самая светлая из тёмных. Проверка «против фона
// секции» даёт ложное «проходит» там, где не проходит (реестр #20, #21).
// Здесь каждая пара считается против того фона, на котором тон реально
// лежит в приложении.
//
// Порог: 4.5:1 — обычный текст; 3:1 — крупный (WCAG 1.4.3: ≥24px, либо
// ≥18.66px при bold/600+). Порог выводится из РАЗМЕРА и НАСЛЕДОВАННОГО
// веса, а не задаётся списком «известных крупных»: иначе подняли бы
// размер на 1px и получили бы «проходит» там, где обычный текст.
//
// Env:
// - TG_BASE_URL (default http://localhost:3012)
// - E2E_CONTRAST_VERBOSE=1 — подробные замеры.
import { chromium } from "playwright";
import { checkPrereqs, reviveDevUser } from "./telegram-fixtures.mjs";

// Стенд готовим сами: без живого приложения шаги падают не по делу (при
// onboardingVersion = NULL показывается экран первого входа — токенов нет).
checkPrereqs();
reviveDevUser();

const TG_BASE = process.env.TG_BASE_URL || "http://localhost:3012";
const VERBOSE = process.env.E2E_CONTRAST_VERBOSE === "1";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, String(error.message ?? error));
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

// pageerror валит прогон — конвенция .opencode/skills/playwright-e2e/SKILL.md.
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.addInitScript(() => {
  localStorage.setItem("edem:theme-override", "light");
});

/** Порог WCAG по размеру и весу: крупный текст — 3:1. */
function thresholdFor(sizePx, weight) {
  const size = Number.parseFloat(sizePx);
  const w = Number(weight) || 400;
  const large = size >= 24 || (size >= 18.66 && w >= 600);
  return large ? 3 : 4.5;
}

/**
 * Замер носителей тона на маршруте.
 *
 * `pick` — селектор внутри page.evaluate; возвращает массив описаний
 * { label, fontSize, fontWeight }. Контраст считается там же, в браузере.
 */
async function measure(route, pick, theme, pseudo = null) {
  const client = await context.newPage();
  const errors = [];
  client.on("pageerror", (e) => errors.push(String(e)));
  await client.addInitScript((t) => {
    localStorage.setItem("edem:theme-override", t);
  }, theme);
  await client.goto(`${TG_BASE}/#${route}`, { waitUntil: "networkidle" });

  // Всё считается ОДНИМ evaluate: и поиск носителей, и контраст. Раньше
  // функции передавались строками и собирались через new Function — это
  // молча ломало вызов (контрастOf не функция), то есть шаг падал по
  // ошибке транспорта, а не по дефекту. Внутри страницы обычные функции.
  const rows = await client.evaluate((pickSrc) => {
    const parseColor = (value) => {
      if (!value) return null;
      const nums = String(value).match(/[\d.]+/g);
      if (!nums || nums.length < 3) return null;
      const alpha = nums.length >= 4 ? Number(nums[3]) : 1;
      if (alpha === 0) return null; // полностью прозрачный — не подложка
      if (String(value).startsWith("color(")) {
        return nums.slice(0, 3).map((v) => Math.round(Number(v) * 255));
      }
      return nums.slice(0, 3).map(Number);
    };
    const channel = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = ([r, g, b]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (fg, bg) => {
      const la = luminance(fg);
      const lb = luminance(bg);
      return +(
        (Math.max(la, lb) + 0.05) /
        (Math.min(la, lb) + 0.05)
      ).toFixed(2);
    };
    /**
     * Подложка под тон текста: вверх по дереву до непрозрачного фона.
     *
     * Ключевой момент — ПРОПУСКАЕМ полупрозрачные фоны. У StatusPill и тонированных
     * плашек собственный фон имеет альфу (0.12–0.18): остановившись на нём,
     * мы сравнили бы тон текста с его собственной заливкой и получили ~1.2:1.
     * Для читаемости важен итоговый цвет ПИКСЕЛЯ, то есть композиция
     * полупрозрачных слоёв до непрозрачного предка. Смешиваем в sRGB по
     * простому «сверху» (последний слой выигрывает) — этого достаточно,
     * чтобы отличить «плашка на белой секции» от «плашка на серой».
     */
    const compositeOver = (top, bottom) => {
      const ta = top.alpha ?? 1;
      if (ta >= 1) return { rgb: top.rgb, alpha: 1 };
      return {
        rgb: top.rgb.map((c, i) => Math.round(c * ta + bottom[i] * (1 - ta))),
        alpha: 1,
      };
    };

    const backdropOf = (el) => {
      // Собираем цепочку собственных полупрозрачных фонов до непрозрачного.
      const layers = [];
      let node = el;
      let solid = null;
      while (node) {
        const raw = getComputedStyle(node).backgroundColor;
        const nums = String(raw || "").match(/[\d.]+/g);
        if (nums && nums.length >= 3) {
          const alpha = nums.length >= 4 ? Number(nums[3]) : 1;
          if (alpha > 0) {
            const rgb = String(raw).startsWith("color(")
              ? nums.slice(0, 3).map((v) => Math.round(Number(v) * 255))
              : nums.slice(0, 3).map(Number);
            if (alpha >= 1) {
              solid = { rgb, alpha: 1 };
              break;
            }
            layers.unshift({ rgb, alpha });
          }
        }
        node = node.parentElement;
      }
      if (!solid) return null;
      // Нал��аем слои на непрозрачную подложку, снизу вверх.
      return layers.reduce((acc, layer) => compositeOver(layer, acc).rgb, solid.rgb);
    };

    const selectors = new Function("s", "return (" + pickSrc + ")(s);");
    const nodes = selectors(null) ?? [];

    return nodes.map((el) => {
      const cs = getComputedStyle(el, pseudo);
      const fg = parseColor(cs.color);
      const bg = backdropOf(el);
      return {
        label: el.textContent?.trim().slice(0, 24) || String(el.className),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        ratio: fg && bg ? contrast(fg, bg) : null,
        error: !fg ? "не разобран цвет текста" : !bg ? "нет непрозрачного фона-предка" : null,
      };
    });
  }, pick.toString());

  await client.close();
  return { rows, errors };
}

/**
 * Контрастный шаг: собрать замеры и проверить порог.
 *
 * `requireMin` — сколько носителей должно быть, иначе селектор молча
 * ничего не нашёл и шаг «прошёл бы» вхолостую. Это ровно тот класс ошибки,
 * что был с протечкой cleanup: проверка, которая проходит, ничего не
 * проверяя.
 */
async function contrastStep({ name, route, pick, theme, requireMin = 1, pseudo = null }) {
  const { rows, errors } = await measure(route, pick, theme, pseudo);
  if (errors.length) throw new Error(`pageerror: ${errors[0]}`);
  if (rows.length < requireMin) {
    throw new Error(
      `найдено носителей ${rows.length}, ожидалось ≥${requireMin} — селектор ничего не нашёл, шаг прошёл бы вхолостую`,
    );
  }
  const failures = [];
  for (const row of rows) {
    if (row.ratio === null) {
      failures.push(`«${row.label}»: нет подложки (${row.error})`);
      continue;
    }
    const need = thresholdFor(row.fontSize, row.fontWeight);
    if (row.ratio < need) {
      failures.push(
        `«${row.label}» ${row.fontSize}/${row.fontWeight}: ${row.ratio}:1 < ${need}:1`,
      );
    }
    if (VERBOSE) {
      console.log(`   · ${name}/${theme}: «${row.label}» ${row.ratio}:1 (нужно ${need})`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
  const worst = rows.reduce((a, r) => Math.min(a, r.ratio ?? 99), 99);
  return `${rows.length} носителей, худший ${worst}:1`;
}

// ── 1. Тон подписи поля ──────────────────────────────────────────────────
// Подпись — это h6 внутри [class*='fieldRoot']; живой на /trips (два поля).
await step("тон подписи поля ≥ AA (светлая тема)", () =>
  contrastStep({
    name: "field-label",
    route: "/trips",
    theme: "light",
    requireMin: 2,
    pick: () =>
      [...document.querySelectorAll("h6")].filter((h) =>
        h.closest("[class*='fieldRoot']"),
      ),
  }),
);

await step("тон подписи поля ≥ AA (тёмная тема)", () =>
  contrastStep({
    name: "field-label",
    route: "/trips",
    theme: "dark",
    requireMin: 2,
    pick: () =>
      [...document.querySelectorAll("h6")].filter((h) =>
        h.closest("[class*='fieldRoot']"),
      ),
  }),
);

// ── 2. Тона Notice (реестр #20) ───────────────────────────────────────────
// Плашка с тоном статуса: success/danger/info/warning. Живёт на /profile/reports
// и в полях форм. Ищем плашки по data-атрибуту тона, если он есть, иначе по
// характерному фону.
await step("тона Notice ≥ AA (светлая тема)", () =>
  contrastStep({
    name: "notice",
    route: "/profile/reports",
    theme: "light",
    requireMin: 1,
    // ТОЛЬКО плашки ui/Notice. Селектор вида `[data-tone], [role='alert']`
    // ловил ещё и StatusPill: тот помечен data-tone, но его фон —
    // полупрозрачная заливка (`… / 0.15`), а не сплошная. Функция подложки
    // умеет искать непрозрачный предок, но останавливается на самой плашке,
    // то есть сравнивала тон текста с его СОБСТВЕННЫМ фоном и давала 1.17:1 —
    // ложное падение. Тона StatusPill проверяются отдельно, по своему фону.
    pick: () =>
      [...document.querySelectorAll("[data-variant]")].filter(
        (el) => el.textContent?.trim(),
      ),
  }),
);

// ── 3. Приглушённый текст (реестр #21) ───────────────────────────────────
// --app-muted: подписи, «Осталось мест», даты. Носители — элементы с
// цветом, отличным от --tgui--text_color, но НЕ h6 (подпись поля уже
// проверена выше) и не кит-примитивы.
await step("приглушённый текст ≥ AA (тёмная тема, худшая тёмная поверхность)", () =>
  contrastStep({
    name: "app-muted",
    route: "/bookings",
    theme: "dark",
    requireMin: 1,
    pick: () => {
      const root = document.querySelector(".app-theme") ?? document.body;
      const probe = document.createElement("span");
      probe.style.color = "var(--app-muted)";
      root.appendChild(probe);
      const target = getComputedStyle(probe).color;
      probe.remove();
      // СРАВНИЕМ ЧИСЛА, а не строки: один и тот же цвет движок отдаёт то как
      // `rgb(135,152,169)`, то как `color(srgb 0.529 0.595 0.664)`. Сравнение
      // строк давало 0 носителей при 38 листьях на странице — шаг валился
      // вхолостую, а не по дефекту.
      const key = (value) => {
        const nums = String(value || "").match(/[\d.]+/g);
        if (!nums || nums.length < 3) return null;
        return String(value).startsWith("color(")
          ? nums.slice(0, 3).map((v) => Math.round(Number(v) * 255)).join(",")
          : nums.slice(0, 3).join(",");
      };
      const wanted = key(target);
      if (!wanted) return [];
      return [...document.querySelectorAll("span, p, div, caption, h1, h2, h3")].filter(
        (el) =>
          el.textContent?.trim() &&
          key(getComputedStyle(el).color) === wanted &&
          !el.closest("[class*='fieldRoot']"),
      );
    },
  }),
);

// ── 4. Плейсхолдеры полей ────────────────────────────────────────────────
// Кит красит ::placeholder в secondary_hint_color — ниже AA на серой
// подложке контрола. Правило — --app-muted (ui.module.css). Носители —
// инпуты/текстареи с непустым placeholder на /support (форма видна
// сразу, без гейтов). Цвет берём из псевдоэлемента, подложку —
// из самого контрола (серая, непрозрачная).
for (const theme of ["light", "dark"]) {
  await step(`плейсхолдеры ≥ AA (${theme === "light" ? "светлая" : "тёмная"} тема)`, () =>
    contrastStep({
      name: "placeholder",
      route: "/support",
      theme,
      requireMin: 1,
      pseudo: "::placeholder",
      pick: () =>
        [...document.querySelectorAll("input[placeholder], textarea[placeholder]")].filter(
          (el) => el.getAttribute("placeholder")?.trim(),
        ),
    }),
  );
}

await step("нет pageerror на экранах", () => {
  if (pageErrors.length) throw new Error(pageErrors.join(" | "));
  return "";
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} проверок контраста прошли` +
    (failed.length ? `, ПРОВАЛЕНО: ${failed.map((f) => f.name).join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);
