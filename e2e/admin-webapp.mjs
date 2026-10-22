// e2e/admin-webapp.mjs — admin panel smoke (Playwright + Chromium).
//
// Покрывает ровно те admin-сценарии, которые нельзя проверить в vitest:
// login через httpOnly cookie, поиск/карточка пользователя, ручной Telegram
// stop, фильтр/карточка жалобы, фильтр обращений и logout.
//
// Детерминизм (skill playwright-e2e):
// - уникальные данные на запуск; id создаются в одной SQL-транзакции;
// - cleanup в finally (pass и fail), его ошибка валит прогон;
// - pageerror/unhandledrejection валят прогон;
// - state-based waits + проверка status у каждого ожидаемого ответа;
// - prerequisites проверяются ДО создания данных (webapp :3013, backend :3011,
//   dev DB и таблица AdminAuditLog).
//
// Env:
// - E2E_ADMIN_URL (default http://localhost:3013)
// - E2E_API_URL (default http://localhost:3011/api/v1)
// - E2E_ADMIN_TOKEN (default dev-admin-token-12345; должен совпадать с backend)
// - E2E_DB_CONTAINER (default: compose db-dev, fallback edem-db-dev)
// - E2E_VERBOSE=1 — печатать причину упавшего screenshot helper.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBAPP_URL = process.env.E2E_ADMIN_URL || "http://localhost:3013";
const API_URL = process.env.E2E_API_URL || "http://localhost:3011/api/v1";
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN || "dev-admin-token-12345";
const VERBOSE = process.env.E2E_VERBOSE === "1";
const SHOTS = path.join(__dirname, "shots-admin");
const RESULTS_JSON = path.join(__dirname, "results-admin.json");

const RUN_ID = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const USER_A_NAME = `E2E Admin User ${RUN_ID}`;
const USER_B_NAME = `E2E Admin Target ${RUN_ID}`;
const USER_A_PHONE = `+7999${String(Date.now() % 10_000_000).padStart(7, "0")}`;
const USER_A_TG = 9_700_000_000 + (Date.now() % 100_000_000);
const USER_B_TG = USER_A_TG + 1;
const TRIP_FROM = `E2E Москва ${RUN_ID}`;
const TRIP_TO = `E2E Тула ${RUN_ID}`;
const REPORT_DESCRIPTION = `E2E report ${RUN_ID}: проверка карточки жалобы`;
const FEEDBACK_UNANSWERED = `E2E обращение без ответа ${RUN_ID}`;
const FEEDBACK_ANSWERED = `E2E обращение с ответом ${RUN_ID}`;
const FEEDBACK_TEXT = `E2E feedback ${RUN_ID}: проверка фильтра обращений`;

function resolveDbContainer() {
  if (process.env.E2E_DB_CONTAINER) return process.env.E2E_DB_CONTAINER;
  try {
    const id = execFileSync(
      "docker",
      ["compose", "--profile", "dev", "ps", "-q", "db-dev"],
      { cwd: path.join(__dirname, ".."), encoding: "utf8" },
    ).trim();
    if (id) return id;
  } catch {
    // compose недоступен — ниже fallback на документированное имя.
  }
  return "edem-db-dev";
}

const DB_CONTAINER = resolveDbContainer();

function psql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "edem",
      "-d",
      "edem",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-F",
      "|",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
}

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function requireOk(label, response) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response;
}

async function checkPrereqs() {
  let web;
  try {
    web = await fetch(WEBAPP_URL, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw new Error(
      `webapp ${WEBAPP_URL} недоступен: ${error.message}. Запустите npm run dev --workspace=webapp`,
    );
  }
  requireOk(`webapp ${WEBAPP_URL}`, web);

  let session;
  try {
    session = await fetch(`${API_URL}/admin/auth/session`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(
      `backend ${API_URL} недоступен: ${error.message}. Запустите npm run dev:backend`,
    );
  }
  requireOk(`backend ${API_URL}`, session);

  if (psql("SELECT 1") !== "1") throw new Error("dev DB не отвечает");
  const schemaReady = psql(
    `SELECT to_regclass('public."AdminSession"') IS NOT NULL
        AND to_regclass('public."AdminAuditLog"') IS NOT NULL`,
  );
  if (schemaReady !== "t") {
    throw new Error(
      "в dev DB нет AdminSession/AdminAuditLog. Примените миграции admin_session и admin_audit_log к dev DB",
    );
  }
}

function setupData() {
  const sql = `
BEGIN;
INSERT INTO "User" ("id", "telegramUserId", "name", "avatar", "phone", "tgChatJoinedAt", "consentAcceptedAt", "onboardingVersion", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), ${USER_A_TG}, ${sqlLiteral(USER_A_NAME)}, '', ${sqlLiteral(USER_A_PHONE)}, NOW(), NOW(), '2', NOW(), NOW())
RETURNING 'USER_A|' || "id"::text;
INSERT INTO "User" ("id", "telegramUserId", "name", "avatar", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), ${USER_B_TG}, ${sqlLiteral(USER_B_NAME)}, '', NOW(), NOW())
RETURNING 'USER_B|' || "id"::text;
INSERT INTO "Trip" ("id", "driverId", "fromCity", "fromAddress", "toCity", "toAddress", "departureAt", "durationMinutes", "distanceKm", "price", "seatsTotal", "seatsAvailable", "tags", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", ${sqlLiteral(TRIP_FROM)}, 'E2E A', ${sqlLiteral(TRIP_TO)}, 'E2E B', NOW() + INTERVAL '2 hours', 120, 180, 500, 3, 2, ARRAY[]::text[], 'active', NOW(), NOW()
FROM "User" WHERE "name" = ${sqlLiteral(USER_A_NAME)}
RETURNING 'TRIP|' || "id"::text;
INSERT INTO "Booking" ("id", "tripId", "passengerId", "seat", "status", "createdAt")
SELECT gen_random_uuid(), t."id", u."id", 1, 'confirmed', NOW()
FROM "Trip" t, "User" u
WHERE t."fromCity" = ${sqlLiteral(TRIP_FROM)} AND u."name" = ${sqlLiteral(USER_B_NAME)}
RETURNING 'BOOKING|' || "id"::text;
INSERT INTO "Report" ("id", "reporterId", "targetType", "targetId", "category", "description", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), reporter."id", 'user', target."id", 'spam', ${sqlLiteral(REPORT_DESCRIPTION)}, 'pending', NOW(), NOW()
FROM "User" reporter, "User" target
WHERE reporter."name" = ${sqlLiteral(USER_B_NAME)} AND target."name" = ${sqlLiteral(USER_A_NAME)}
RETURNING 'REPORT|' || "id"::text;
INSERT INTO "Feedback" ("id", "userId", "subject", "text", "createdAt")
SELECT gen_random_uuid(), "id", ${sqlLiteral(FEEDBACK_UNANSWERED)}, ${sqlLiteral(FEEDBACK_TEXT)}, NOW()
FROM "User" WHERE "name" = ${sqlLiteral(USER_A_NAME)}
RETURNING 'FEEDBACK_UNANSWERED|' || "id"::text;
INSERT INTO "Feedback" ("id", "userId", "subject", "text", "reply", "repliedAt", "createdAt")
SELECT gen_random_uuid(), "id", ${sqlLiteral(FEEDBACK_ANSWERED)}, ${sqlLiteral(FEEDBACK_TEXT)}, 'E2E reply', NOW(), NOW()
FROM "User" WHERE "name" = ${sqlLiteral(USER_A_NAME)}
RETURNING 'FEEDBACK_ANSWERED|' || "id"::text;
COMMIT;
`;
  const rows = psql(sql)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ids = Object.fromEntries(
    rows.map((line) => {
      const [key, id] = line.split("|");
      return [key, id];
    }),
  );
  for (const key of [
    "USER_A",
    "USER_B",
    "TRIP",
    "BOOKING",
    "REPORT",
    "FEEDBACK_UNANSWERED",
    "FEEDBACK_ANSWERED",
  ]) {
    if (!ids[key]) throw new Error(`setup: no id for ${key}`);
  }
  return ids;
}

function cleanupData(ids) {
  const targets = [
    ids.USER_A,
    ids.USER_B,
    ids.TRIP,
    ids.BOOKING,
    ids.REPORT,
    ids.FEEDBACK_UNANSWERED,
    ids.FEEDBACK_ANSWERED,
  ]
    .map(sqlLiteral)
    .join(", ");
  const users = [ids.USER_A, ids.USER_B].map(sqlLiteral).join(", ");
  psql(`
BEGIN;
DELETE FROM "AdminAuditLog" WHERE "targetId" IN (${targets});
DELETE FROM "Feedback" WHERE "id" IN (${sqlLiteral(ids.FEEDBACK_UNANSWERED)}, ${sqlLiteral(ids.FEEDBACK_ANSWERED)});
DELETE FROM "Report" WHERE "id" = ${sqlLiteral(ids.REPORT)};
DELETE FROM "Booking" WHERE "id" = ${sqlLiteral(ids.BOOKING)};
DELETE FROM "Trip" WHERE "id" = ${sqlLiteral(ids.TRIP)};
DELETE FROM "User" WHERE "id" IN (${users});
COMMIT;
`);
}

function createHarness(page) {
  const results = [];
  const pageErrors = [];
  const unhandledRejections = [];
  let stepNo = 0;

  const record = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(
      `${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`,
    );
  };

  async function diagnose(name) {
    try {
      const file = `${String(stepNo).padStart(2, "0")}-${name}.png`;
      await page.screenshot({ path: path.join(SHOTS, file) });
      const text = await page.evaluate(() =>
        document.body.innerText.slice(0, 300),
      );
      return `screen=${file} text=${JSON.stringify(text)}`;
    } catch (error) {
      if (VERBOSE) console.log(`  [diagnose] ${error.message}`);
      return "diagnose failed";
    }
  }

  async function runStep(name, fn) {
    stepNo++;
    try {
      const detail = await fn();
      record(name, true, detail ?? "");
      return true;
    } catch (error) {
      const message = String(error.message || error)
        .split("\n")
        .slice(0, 3)
        .join(" ")
        .slice(0, 300);
      record(name, false, `${message} | ${await diagnose(name)}`);
      return false;
    }
  }

  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}`));
  const initScript = () => {
    window.__adminE2eRejections = [];
    window.addEventListener("unhandledrejection", (event) => {
      window.__adminE2eRejections.push(
        String(event.reason?.message || event.reason),
      );
    });
  };
  // addInitScript возвращает Promise; вызывающий await'ит его до goto.
  const watch = () => page.addInitScript(initScript);

  async function collectRejections() {
    try {
      const list = await page.evaluate(
        () => window.__adminE2eRejections || [],
      );
      for (const message of list) {
        unhandledRejections.push(`unhandledrejection: ${message}`);
      }
    } catch (error) {
      if (VERBOSE) console.log(`  [rejections] ${error.message}`);
    }
  }

  function verdict() {
    for (const message of pageErrors) record("pageerror", false, message);
    for (const message of unhandledRejections) {
      record("unhandledrejection", false, message);
    }
    const ok = results.every((result) => result.ok);
    fs.writeFileSync(RESULTS_JSON, JSON.stringify({ results }, null, 2));
    return ok;
  }

  return { runStep, watch, collectRejections, verdict };
}

function isAdminApi(response, pathname, params = {}) {
  const url = new URL(response.url());
  if (url.pathname !== `/api/v1/admin${pathname}`) return false;
  return Object.entries(params).every(
    ([key, value]) => url.searchParams.get(key) === value,
  );
}

async function waitForAdminOk(page, pathname, params, action) {
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      isAdminApi(response, pathname, params),
    ),
    action(),
  ]);
  requireOk(`GET ${pathname}`, response);
  return response;
}

async function waitForUrl(page, matcher) {
  await page.waitForURL((url) => matcher.test(url.pathname), {
    timeout: 15_000,
  });
}

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

try {
  await checkPrereqs();
} catch (error) {
  console.error(`⛔ Prerequisite failed: ${error.message}`);
  console.error("   Прогон не запущен — данные не созданы.");
  process.exit(2);
}

let ids = null;
let browser = null;
let runOk = true;
let cleanupError = null;

try {
  ids = setupData();
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const harness = createHarness(page);
  await harness.watch();

  const steps = [
    [
      "auth: вход по ADMIN_TOKEN",
      async () => {
        await page.goto(`${WEBAPP_URL}/login`, { waitUntil: "commit" });
        const tokenInput = page.locator("#admin-token");
        await tokenInput.waitFor();
        await tokenInput.fill(ADMIN_TOKEN);
        await page.getByRole("button", { name: "Войти" }).click();
        await waitForUrl(page, /^\/dashboard$/);
        await page.getByText("Требует внимания").waitFor();
        return "dashboard";
      },
    ],
    [
      "users: поиск по имени и карточка",
      async () => {
        await page.getByRole("link", { name: "Пользователи" }).click();
        await waitForUrl(page, /^\/users$/);
        const input = page.getByLabel("Имя");
        await input.waitFor();
        await waitForAdminOk(
          page,
          "/users",
          { q: USER_A_NAME },
          () => input.fill(USER_A_NAME),
        );
        const row = page
          .getByRole("row")
          .filter({ has: page.getByText(USER_A_NAME, { exact: true }) });
        await row.waitFor();
        await waitForAdminOk(
          page,
          `/users/${ids.USER_A}`,
          {},
          () => row.getByRole("button", { name: "Детали" }).click(),
        );
        const dialog = page.getByRole("dialog", { name: USER_A_NAME });
        await dialog.waitFor();
        await dialog.getByText(USER_A_PHONE, { exact: true }).waitFor();
        await dialog.getByText("Telegram: подключён", { exact: true }).waitFor();
        return "user card";
      },
    ],
    [
      "users: Telegram stop",
      async () => {
        const userDialog = page.getByRole("dialog", { name: USER_A_NAME });
        await userDialog
          .getByRole("button", { name: "Остановить Telegram" })
          .click();
        const confirm = page.getByRole("dialog", {
          name: "Остановить Telegram-уведомления?",
        });
        await confirm.waitFor();
        await confirm.getByRole("button", { name: "Остановить", exact: true }).click();
        await page.getByText(/Telegram остановлен/).waitFor();
        await userDialog.getByText("Telegram: нет", { exact: true }).waitFor();
        await userDialog.getByText("Не подключён", { exact: true }).waitFor();
        await userDialog.getByRole("button", { name: "Закрыть" }).click();
        await userDialog.waitFor({ state: "detached" });
        return "stopped";
      },
    ],
    [
      "reports: фильтр по объекту и карточка",
      async () => {
        await page.getByRole("link", { name: "Жалобы" }).click();
        await waitForUrl(page, /^\/reports$/);
        const targetType = page.locator("#reports-target-type-filter");
        await targetType.waitFor();
        await waitForAdminOk(
          page,
          "/reports",
          { targetType: "user" },
          () => targetType.selectOption("user"),
        );
        const card = page
          .locator("article")
          .filter({ hasText: REPORT_DESCRIPTION });
        await card.waitFor();
        await waitForAdminOk(
          page,
          `/reports/${ids.REPORT}`,
          {},
          () => card.getByRole("button", { name: "Открыть" }).click(),
        );
        const dialog = page.getByRole("dialog", { name: USER_A_NAME });
        await dialog.waitFor();
        await dialog.getByText(REPORT_DESCRIPTION).waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        return "report detail";
      },
    ],
    [
      "feedback: фильтр без ответа и карточка",
      async () => {
        await page.getByRole("link", { name: "Обратная связь" }).click();
        await waitForUrl(page, /^\/feedback$/);
        const search = page.getByRole("searchbox", {
          name: "Поиск обращений по теме, тексту или имени",
        });
        await search.waitFor();
        await waitForAdminOk(
          page,
          "/feedback",
          { q: FEEDBACK_UNANSWERED },
          () => search.fill(FEEDBACK_UNANSWERED),
        );
        const answeredFilter = page.locator(
          'select[aria-label="Фильтр обращений по наличию ответа"]',
        );
        await waitForAdminOk(
          page,
          "/feedback",
          { q: FEEDBACK_UNANSWERED, answered: "false" },
          () => answeredFilter.selectOption("false"),
        );
        const openUnanswered = page.getByRole("button", {
          name: `Открыть обращение: ${FEEDBACK_UNANSWERED}`,
        });
        await openUnanswered.waitFor();
        if (
          (await page.getByText(FEEDBACK_ANSWERED, { exact: true }).count()) !==
          0
        ) {
          throw new Error("answered feedback leaked through answered=false");
        }
        await waitForAdminOk(
          page,
          `/feedback/${ids.FEEDBACK_UNANSWERED}`,
          {},
          () => openUnanswered.click(),
        );
        const dialog = page.getByRole("dialog", {
          name: FEEDBACK_UNANSWERED,
        });
        await dialog.waitFor();
        await dialog.getByText(FEEDBACK_TEXT, { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        return "feedback filter + detail";
      },
    ],
    [
      "auth: logout очищает cookie",
      async () => {
        await page
          .getByRole("button", {
            name: "Выйти из панели администратора",
          })
          .click();
        await waitForUrl(page, /^\/login$/);
        await page.locator("#admin-token").waitFor();
        return "login page";
      },
    ],
  ];

  for (const [name, fn] of steps) {
    const ok = await harness.runStep(name, fn);
    runOk = runOk && ok;
  }

  await harness.collectRejections();
  runOk = harness.verdict() && runOk;
} catch (error) {
  runOk = false;
  console.error(`❌ admin smoke crashed: ${error.message}`);
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      runOk = false;
      console.error(`❌ browser close failed: ${error.message}`);
    }
  }
  if (ids) {
    try {
      cleanupData(ids);
      console.log("🧹 test data removed");
    } catch (error) {
      cleanupError = error;
      runOk = false;
      console.error(`❌ cleanup failed: ${error.message}`);
    }
  }
}

if (cleanupError) {
  console.error("⛔ Тестовые данные могли остаться в dev DB.");
}
process.exitCode = runOk ? 0 : 1;
