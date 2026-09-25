// e2e/telegram-fixtures.mjs
// Общие фикстуры Telegram-parity E2E (tg-migration-17): harness прогона
// (record/runStep, pageerror+rejections валят прогон), env-оверрайды,
// dev-auth через реальный /auth/telegram (dev-bypass hash=dev-hash,
// без allowlist-хаков), API-обёртка, docker-psql time-travel и чистка.
//
// UI-идентичность — мокнутый dev-юзер mockEnv.ts (id 9800001): второй участник
// всегда идёт через API (свой JWT через тот же dev-bypass).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TG_URL = process.env.E2E_TG_URL || "http://localhost:3012";
export const API_URL =
  process.env.E2E_API_URL || "http://localhost:3011/api/v1";
export const DB_CONTAINER =
  process.env.E2E_DB_CONTAINER || "edem-db-dev";
export const VERBOSE = process.env.E2E_VERBOSE === "1";
export const SHOTS = path.join(__dirname, "shots-tg");
export const RESULTS_JSON = path.join(__dirname, "results-tg.json");

/** Мокнутый dev-юзер UI (mockEnv.ts). */
export const DEV_TG_ID = 9800001;
/** Контрагент через API (не пересекается с backend-сьютами 9_9xx_xxx). */
export const PEER_TG_ID = 9890001;

export const RUN_ID = `${Date.now().toString(36)}${process.pid.toString(36)}`;
export const PRICE = 700 + ((Date.now() + process.pid) % 90);
export const PRICE_LABEL = `${PRICE} ₽`;

export function ensureShotsDir() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
}

export function createHarness() {
  const results = [];
  const pageErrors = [];
  const unhandledRejections = [];

  function record(name, ok, detail = "") {
    results.push({ name, ok, detail });
    console.log(
      `${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`,
    );
  }

  async function runStep(name, fn) {
    try {
      const detail = await fn();
      record(name, true, detail ?? "");
      return true;
    } catch (e) {
      record(name, false, String(e.message || e).split("\n").slice(0, 3).join(" ").slice(0, 300));
      return false;
    }
  }

  /** Коллектор pageerror + unhandledrejection: непустые валят прогон. */
  async function watchPage(page, tag) {
    page.on("pageerror", (e) => pageErrors.push(`${tag}: ${e.message}`));
    await page.addInitScript(() => {
      window.__tgRejections = [];
      window.addEventListener("unhandledrejection", (event) => {
        window.__tgRejections.push(String(event.reason?.message || event.reason));
      });
    });
  }

  async function collectRejections(page, tag) {
    try {
      const list = await page.evaluate(() => window.__tgRejections || []);
      for (const message of list) unhandledRejections.push(`${tag}: ${message}`);
    } catch (e) {
      if (VERBOSE) console.log(`rejections collect failed (${tag}): ${e.message}`);
    }
  }

  function verdict() {
    for (const message of pageErrors) record("pageerror", false, message);
    for (const message of unhandledRejections) record("unhandledrejection", false, message);
    const failed = results.filter((r) => !r.ok);
    fs.writeFileSync(RESULTS_JSON, JSON.stringify({ results }, null, 2));
    return failed.length === 0;
  }

  return { results, runStep, watchPage, collectRejections, verdict };
}

/** Dev-initData формата dev-bypass (формат backend dev-mock-auth). */
export function devInitData(tgId, firstName = "E2E") {
  return new URLSearchParams([
    ["user", JSON.stringify({ id: tgId, first_name: firstName })],
    ["auth_date", String(Math.floor(Date.now() / 1000))],
    ["hash", "dev-hash"],
  ]).toString();
}

/** Реальный вход через POST /auth/telegram → accessToken (dev-bypass). */
export async function tgApiLogin(tgId, firstName = "E2E") {
  const res = await fetch(`${API_URL}/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: devInitData(tgId, firstName) }),
  });
  if (!res.ok) throw new Error(`tgApiLogin ${tgId}: HTTP ${res.status}`);
  const body = await res.json();
  return { userId: body.user.id, accessToken: body.accessToken };
}

/** API-вызов с JWT: бросает на не-2xx с телом для диагностики шага. */
export async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new Error(`API ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return parsed;
}

/** Time-travel / проверки через dev-БД (как full-cycle.mjs). */
export function psql(query) {
  // execFileSync без shell: двойные кавычки quoted camelCase-таблиц
  // ("Trip", "City") доходят до psql как есть. Через execSync+shell
  // они рвали бы кавычки и Postgres искал бы lowercase-имена.
  return execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "edem", "-d", "edem", "-tAc", query],
    { encoding: "utf-8" },
  ).trim();
}

export function checkPrereqs() {
  try {
    const out = psql("SELECT 1");
    if (out !== "1") throw new Error("unexpected output");
  } catch {
    console.error(
      `⛔ Prerequisite failed: docker exec ${DB_CONTAINER} psql недоступен.\n` +
        `   Запустите dev-БД (docker compose) либо задайте E2E_DB_CONTAINER. ` +
        `Прогон не запущен — данные не созданы.`,
    );
    process.exit(2);
  }
}

/** Чистка сущностей прогона (идемпотентна). Неудача валит прогон. */
export async function cleanupRun({ tripId, tripIds = [], peerUserId, feedbackTexts = [] }) {
  const steps = [];
  for (const id of [tripId, ...tripIds].filter(Boolean)) {
    steps.push(`DELETE FROM "Review" WHERE "tripId" = '${id}'`);
    steps.push(`DELETE FROM "Booking" WHERE "tripId" = '${id}'`);
    steps.push(`DELETE FROM "Trip" WHERE "id" = '${id}'`);
  }
  for (const text of feedbackTexts) {
    steps.push(`DELETE FROM "Feedback" WHERE "text" = '${text}'`);
  }
  if (peerUserId) {
    steps.push(`DELETE FROM "Notification" WHERE "userId" = '${peerUserId}'`);
    steps.push(`DELETE FROM "User" WHERE id = '${peerUserId}'`);
  }
  // Dev-юзер UI: шаг delete анонимизирует его (tombstone + каскад по
  // поездкам/броням). Пользователя НЕ удаляем — на нём висят сид-поездки
  // (FK), а его отсутствие погасило бы следующий прогон. Вместо удаления
  // возвращаем identity сида, чтобы rerun стартовал с живого аккаунта.
  steps.push(
    `UPDATE "User" SET "deletedAt" = NULL, "name" = 'Dev Telegram', "avatar" = '', "about" = 'Тестовый аккаунт разработчика (dev-стенд).' WHERE "telegramUserId" = ${DEV_TG_ID}`,
  );
  for (const query of steps) {
    const out = psql(query);
    // UPDATE — реанимация dev-юзера, DELETE — сущности прогона.
    if (!/^(DELETE|UPDATE)/.test(out)) {
      throw new Error(`cleanup failed: ${query} → ${out}`);
    }
  }
}
