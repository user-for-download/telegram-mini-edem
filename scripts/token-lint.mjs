// Дизайн-токены telegram-app: запрет on-scale литералов в модулях.
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

async function collectModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectModules(absolutePath)));
    } else if (entry.name.endsWith(".module.css")) {
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      if (relativePath.includes(SKIP_PATH_SEGMENT)) continue;
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

const errors = [];

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
