import { chromium } from "playwright";
import { psql } from "./telegram-fixtures.mjs";

const TG_URL = "http://localhost:3012";
const RUN_ID = `dbg${Date.now().toString(36)}`;
const CITY_FROM = `Е2Е-Москва-${RUN_ID}`;
const CITY_TO = `Е2Е-Тула-${RUN_ID}`;
const norm = (s) => s.trim().toLowerCase();

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("dialog", (d) => void d.accept());
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 300)); });
page.on("response", (r) => { if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 120)); });
await page.goto(`${TG_URL}/`, { waitUntil: "commit" });
await page.getByText(/Найти поездку|Добро пожаловать/).first().waitFor({ timeout: 120000 });
try {
  const pre = page.getByRole("button", { name: "Принять и продолжить" });
  await pre.waitFor({ state: "visible", timeout: 8000 });
  await pre.click();
} catch {
  // Онбординг может не показаться (уже принят) — идём дальше.
}
// Прайминг кэша как в e2e: /trips и /profile ДО сида городов.
await page.goto(`${TG_URL}/#/trips`, { waitUntil: "commit" });
await page.getByText("Поиск попутных поездок").first().waitFor({ timeout: 30000 });
await page.goto(`${TG_URL}/#/profile`, { waitUntil: "commit" });
await page.getByText("Dev Telegram").first().waitFor({ timeout: 60000 });
const devRow = psql(`SELECT "id" FROM "User" WHERE "telegramUserId" = 9800001`);
psql(`DELETE FROM "Review" WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active')`);
psql(`DELETE FROM "Booking" WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active')`);
psql(`DELETE FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active'`);
psql(`INSERT INTO "Car" ("id", "userId", "model", "color") VALUES (gen_random_uuid(), '${devRow}', 'Lada Vesta', 'белый') ON CONFLICT ("userId") DO NOTHING`);
// Сид ПОСЛЕ прайминга кэша — как в e2e.
psql(`INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_FROM}', '${norm(CITY_FROM)}', NOW(), NOW())`);
psql(`INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_TO}', '${norm(CITY_TO)}', NOW(), NOW())`);

await page.goto(`${TG_URL}/#/trips/my/new`, { waitUntil: "commit" });
await page.getByLabel("Город отправления").fill(CITY_FROM);
const opts = await page.getByText(CITY_FROM, { exact: true }).allTextContents().catch((e) => `NO-OPTIONS: ${e.message.slice(0, 100)}`);
console.log("OPTIONS-FROM:", JSON.stringify(opts));
await page.getByText(CITY_FROM, { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log("CLICK-FROM-FAIL:", e.message.slice(0, 150)));
await page.getByLabel("Город назначения").fill(CITY_TO);
await page.getByText(CITY_TO, { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log("CLICK-TO-FAIL:", e.message.slice(0, 150)));
const dep = new Date(Date.now() + 14 * 86400e3 + (Date.now() % 3600000) + (process.pid % 60) * 60000);
const pad = (n) => String(n).padStart(2, "0");
await page.locator('input[type="datetime-local"]').fill(`${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T${pad(dep.getHours())}:${pad(dep.getMinutes())}`);
await page.getByLabel("Расстояние, км").fill("180");
await page.getByLabel("Цена, ₽").fill("777");
const more = page.getByRole("button", { name: "Больше мест" });
await more.click(); await more.click();
await page.getByRole("button", { name: "Опубликовать" }).click();
const nav = await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/, { timeout: 15000 }).then(() => "NAV-OK").catch((e) => `NAV-FAIL: ${e.message.slice(0, 120)}`);
console.log(nav);
console.log("URL:", page.url());
const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
console.log("BODY:", JSON.stringify(body));
// Чистка: поездка + города + юзер.
const tripIds = psql(`SELECT COALESCE(string_agg("id"::text, ','), 'none') FROM "Trip" WHERE "driverId" = '${devRow}'`);
console.log("TRIPS-CREATED:", tripIds);
await browser.close();
