// Дизайн-токены telegram-app: два независимых запрета.
//
// 1) On-scale литералы отступов в модулях.
//
// Канон (telegram-app/src/ui/README.md, «Правило для нового компонента», п.2):
// «литералов цветов и паддингов в модулях не бывает». Значения шкалы
// --app-space-* (4/8/12/16/24/40px) обязаны идти токеном — иначе bump
// токенов не распространяется на место, и экран молча разъезжается.
//
// Скоуп: telegram-app/src/**/*.module.css, КРОМЕ src/ui/** (фасад сам владеет
// токенами). Off-scale (2/3/5/6/10/14/20/30px), отрицательные margin,
// calc()/min()/max()/clamp()/env() и строки-комментарии — не нарушения.
//
// 2) Ссылки на НЕОБЪЯВЛЕННЫЕ токены (добавлено 2026-10-13).
//
// Проверка 1 молчала про цвета, и класс дефектов проходил ревью незамеченным:
// `--app-radius-card` (опечатка вместо --app-card-radius),
// `--tgui-destructive-text-color` (single-dash), `--app-color-danger`.
// Каждый такой токен молча уезжал в var()-фолбэк — то есть висял ЛИТЕРАЛ
// вне темы: красный #d14343 в тёмной палитре не тот, серый #999 в обеих.
//
// Теперь каждый `var(--x)` должен быть объявлен в ките, в CSS проекта либо
// принадлежать списку SDK-runtime префиксов (их SDK заводит в рантайме и
// CSS их не содержит — в этом весь их смысл).
//
// Без новых зависимостей (по образцу scripts/format-check.mjs).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const TARGET_DIR = "telegram-app/src";
const SKIP_DIRS = new Set(["node_modules", "dist", "test", "tests"]);

/** Шкала --app-space-* (telegram-app/src/index.css). */
const ON_SCALE = new Map([
  [4, "--app-space-2xs"],
  [8, "--app-space-xs"],
  [12, "--app-space-sm"],
  [16, "--app-space-md"],
  [24, "--app-space-lg"],
  [40, "--app-space-xl"],
]);

// Область фасада владеет токенами сама — там литералы допустимы осознанно.
const SKIP_PATH_SEGMENT = "/ui/";

// Baseline новых нарушений нет: миграция B3 (2026-09-30) закрыла все 65.
// Механизм оставлен для будущих осознанных исключений (формат: "path:line").
const legacyLiteralSpacing = new Set([]);

const SPACING_PROP =
  /^\s*(gap|padding|padding-(?:top|right|bottom|left)|margin|margin-(?:top|right|bottom|left))\s*:\s*([^;]+);?/;
// Убираем вызовы функций (var/calc/min/max/clamp/env) — их содержимое вне правил.
const FUNCTION_CALL =
  /\b(?:var|calc|min|max|clamp|env)\((?:[^()]|\([^()]*\))*\)/g;
const PX = /(-?)(\d+(?:\.\d+)?)px/g;

/** Удаляет блочные комментарии (в CSS построчных нет). */
function stripCssComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

async function collectCss(directory, { moduleOnly }) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectCss(absolutePath, { moduleOnly })));
    } else if (entry.name.endsWith(".css")) {
      // Проверка 1 (шкала отступов) — только *.module.css и без src/ui/**.
      // Проверка 2 (необъявленные токены) — ВСЕ .css включая src/ui/**
      // и index.css: висящий токен был именно в ui.module.css, и исключение
      // фасада его бы пропустило.
      if (moduleOnly && !entry.name.endsWith(".module.css")) continue;
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      if (moduleOnly && relativePath.includes(SKIP_PATH_SEGMENT)) continue;
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

function collectModules(directory) {
  return collectCss(directory, { moduleOnly: true });
}

const errors = [];

/* ── Проверка 2: ссылки на необъявленные токены ───────────────────────────
   Собираем: (а) что объявляет кит, (б) что объявляет CSS проекта,
   (в) какие префиксы заводит SDK в рантайме. */

const KIT_STYLES =
  "node_modules/@telegram-apps/telegram-ui/dist/styles.css";

/** Префиксы, которые SDK объявляет в рантайме (tapps/`--tg-*`). */
const SDK_RUNTIME_PREFIXES = [
  /^--tg-theme-/,
  /^--tg-safe-area/,
  /^--tg-viewport/,
  /^--tg-content/,
  /^--tg-telegram/,
  /^--tgui--(?:safe_area|viewport)/,
];

const CUSTOM_PROPERTY = /(--[A-Za-z0-9_-]+)\s*:/g;
const VAR_REFERENCE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

async function collectAllCss(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectAllCss(absolutePath)));
    } else if (entry.name.endsWith(".css")) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** Объявленные где-либо в проекте токены (кит + весь src, включая index.css). */
async function collectDeclaredTokens() {
  const declared = new Set();
  const sources = [path.join(root, KIT_STYLES), ...(await collectAllCss(path.join(root, TARGET_DIR)))];
  for (const file of sources) {
    const content = await readFile(file, "utf8");
    for (const [, name] of stripCssComments(content).matchAll(CUSTOM_PROPERTY)) {
      declared.add(name);
    }
  }
  return declared;
}

const declaredTokens = await collectDeclaredTokens();

// Проверка 2 — по ВСЕМ .css (src/ui/** и index.css включительно).
for (const { absolutePath, relativePath } of await collectCss(
  path.join(root, TARGET_DIR),
  { moduleOnly: false },
)) {
  const stripped = stripCssComments(await readFile(absolutePath, "utf8"));
  stripped.split("\n").forEach((line, index) => {
    // `var(--x)` может стоять в любой части значения (в т.ч. внутри
    // color-mix/calc), а не только в шкале отступов — поэтому построчно.
    for (const [, name] of line.matchAll(VAR_REFERENCE)) {
      if (declaredTokens.has(name)) continue;
      if (SDK_RUNTIME_PREFIXES.some((pattern) => pattern.test(name))) continue;
      errors.push(
        `${relativePath}:${index + 1}: необъявленный токен ${name} ` +
          `(нет ни в ките, ни в CSS проекта, ни среди SDK-runtime) — ` +
          `значение молча уедет в var()-фолбэк; проверьте написание`,
      );
    }
  });
}

// Проверка 1 — только модули вне фасада (см. SKIP_PATH_SEGMENT).
for (const { absolutePath, relativePath } of await collectModules(
  path.join(root, TARGET_DIR),
)) {
  const stripped = stripCssComments(await readFile(absolutePath, "utf8"));
  stripped.split("\n").forEach((line, index) => {
    const match = line.match(SPACING_PROP);
    if (!match) return;
    const value = match[2].replace(FUNCTION_CALL, " ");
    for (const px of value.matchAll(PX)) {
      const [, sign, digits] = px;
      if (sign === "-") continue; // отрицательные margin — осознанный приём
      const size = Number(digits);
      const token = ON_SCALE.get(size);
      if (!token) continue; // off-scale — вне канона шкалы
      const location = `${relativePath}:${index + 1}`;
      if (legacyLiteralSpacing.has(location)) continue;
      errors.push(
        `${location}: "${line.trim()}" → используйте var(${token}) ` +
          `(шкала --app-space-*; см. ui/README.md)`,
      );
    }
  });
}

if (errors.length > 0) {
  console.error(
    `Token check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Token check passed.\n");
}
