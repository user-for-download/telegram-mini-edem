import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".opencode",
  ".tmp",
  "assets",
  "build",
  "coverage",
  "dist",
  "dump",
  "fix",
  "generated",
  "node_modules",
]);
// Existing whitespace is baselined by exact location so new violations still fail.
// Remove entries when those lines are naturally touched by future product work.
const legacyTrailingWhitespace = new Set([
  "backend/src/services/notification.service.ts:34",
  "backend/src/trips/index.ts:516",
]);
const legacyMissingFinalNewline = new Set([]);
const textExtensions = new Set([
  ".cjs", ".css", ".example", ".js", ".json", ".md", ".mjs", ".prisma",
  ".scss", ".sh", ".ts", ".tsx", ".yaml", ".yml",
]);

/**
 * JSONC по соглашению: tsconfig-файлы (TypeScript сам парсит их с комментариями)
 * и opencode.json. Такие файлы проверяем после вычистки комментариев
 * и trailing-запятых; остальные .json — строгим JSON.parse.
 */
function isJsoncFile(relativePath) {
  const base = path.basename(relativePath);
  return base.startsWith("tsconfig") || base === "opencode.json";
}

/** Убирает // и /* *\/ комментарии, не трогая содержимое строк. */
function stripJsoncComments(content) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
    } else {
      out += ch;
    }
  }

  return out;
}

/** Удаляет запятые перед `}`/`]` вне строк (trailing commas из JSONC). */
function stripTrailingCommas(content) {
  let out = "";
  let inString = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += content[i + 1] ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) j += 1;
      if (content[j] === "}" || content[j] === "]") continue;
    }

    out += ch;
  }

  return out;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...(await collectFiles(absolutePath)));
    } else if (textExtensions.has(path.extname(entry.name))) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

/**
 * Выкидывает файлы, которые git считает игнорируемыми.
 *
 * ЗАЧЕМ. `ignoredDirectories` выше перечисляет каталоги по имени, но
 * `.gitignore`-файлы (в том числе вложенные, как `e2e/.gitignore`) он не читает.
 * Из-за этого СГЕНЕРИРУЕМЫЕ артефакты роняли гейт: прогон e2e пишет
 * `e2e/results-tg.json` без финального перевода строки, и после любого
 * локального прогона `npm run format:check` падал на файле, которого нет в
 * репозитории. Проверять мусор, который не коммитится, бессмысленно.
 *
 * Реализация — `git check-ignore` (одна пачка на все пути), потому что
 * разбирать семантику .gitignore вручную (якорь, `**`, negation) — это
 * источник тихих расхождений. Если git недоступен или это не репозиторий,
 * ничего не выкидываем: поведение деградирует к прежнему, гейт не ломается.
 */
function dropGitIgnored(files) {
  if (files.length === 0) return files;

  try {
    const result = spawnSync(
      "git",
      ["check-ignore", "--stdin", "-z"],
      { cwd: root, input: files.map((file) => `${file.relativePath}\0`).join(""), encoding: "utf8" },
    );

    // 1 = часть путей проигнорирована, 0 = ни один, иначе (не репозиторий и т. п.).
    if (result.status !== 0 && result.status !== 1) return files;

    const ignored = new Set((result.stdout ?? "").split("\0").filter(Boolean));
    if (ignored.size === 0) return files;

    return files.filter((file) => !ignored.has(file.relativePath));
  } catch {
    return files;
  }
}

const errors = [];

const collected = await collectFiles(root);
const files = dropGitIgnored(collected);

for (const { absolutePath, relativePath } of files) {
  const content = await readFile(absolutePath, "utf8");

  if (content.includes("\r")) errors.push(`${relativePath}: contains CRLF/CR characters`);
  if (
    content.length > 0 &&
    !content.endsWith("\n") &&
    !legacyMissingFinalNewline.has(relativePath)
  ) {
    errors.push(`${relativePath}: missing final newline`);
  }

  content.split("\n").forEach((line, index) => {
    const location = `${relativePath}:${index + 1}`;
    if (/[ \t]+$/.test(line) && !legacyTrailingWhitespace.has(location)) {
      errors.push(`${location}: trailing whitespace`);
    }
  });

  if (path.extname(relativePath) === ".json") {
    const parseText = isJsoncFile(relativePath)
      ? stripTrailingCommas(stripJsoncComments(content))
      : content;
    try {
      JSON.parse(parseText);
    } catch (error) {
      errors.push(`${relativePath}: invalid JSON (${error.message})`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Format check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  process.stdout.write("Format check passed.\n");
}
