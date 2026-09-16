import { chromium } from "playwright";
import { psql } from "./telegram-fixtures.mjs";

const TG_URL = "http://localhost:3012";
const CITY_FROM = `Е2Е-Москва-z${Date.now().toString(36)}`;
const CITY_TO = `Е2Е-Тула-z${Date.now().toString(36)}`;
const norm = (s) => s.trim().toLowerCase();
psql(`INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_FROM}', '${norm(CITY_FROM)}', NOW(), NOW())`);
psql(`INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_TO}', '${norm(CITY_TO)}', NOW(), NOW())`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("dialog", (d) => void d.accept());
await page.goto(`${TG_URL}/`, { waitUntil: "commit" });
await page.getByText(/Найти поездку|Добро пожаловать/).first().waitFor({ timeout: 120000 });
try {
  const pre = page.getByRole("button", { name: "Принять и продолжить" });
  await pre.waitFor({ state: "visible", timeout: 8000 });
  await pre.click();
} catch {}
await page.goto(`${TG_URL}/#/profile`, { waitUntil: "commit" });
await page.getByText("Dev Telegram").first().waitFor({ timeout: 60000 });
const devRow = psql(`SELECT "id" FROM "User" WHERE "telegramUserId" = 9800001`);
psql(`DELETE FROM "Review" WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active')`);
psql(`DELETE FROM "Booking" WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active')`);
psql(`DELETE FROM "Trip" WHERE "driverId" = '${devRow}' AND "status" = 'active'`);
psql(`INSERT INTO "Car" ("id", "userId", "model", "color") VALUES (gen_random_uuid(), '${devRow}', 'Lada', 'белая') ON CONFLICT ("userId") DO NOTHING`);
await page.goto(`${TG_URL}/#/trips/my/new`, { waitUntil: "commit" });
await page.getByLabel("Город отправления").fill(CITY_FROM);
await page.getByText(CITY_FROM, { exact: true }).first().click();
await page.getByLabel("Город назначения").fill(CITY_TO);
await page.getByText(CITY_TO, { exact: true }).first().click();
const dep = new Date(Date.now() + 14 * 86400e3 + (Date.now() % 3600000) + (process.pid % 60) * 60000);
const pad = (n) => String(n).padStart(2, "0");
await page.locator('input[type="datetime-local"]').fill(`${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T${pad(dep.getHours())}:${pad(dep.getMinutes())}`);
await page.getByLabel("Расстояние, км").fill("180");
await page.getByLabel("Цена, ₽").fill("777");
await page.getByRole("button", { name: "Опубликовать" }).click();
await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/, { timeout: 30000 });
await page.getByText("Управление поездкой").first().waitFor({ timeout: 15000 });
// Ждём дольше тоста (3.2с) и пробуем как в e2e:
await page.waitForTimeout(6000);
const probe = await page.evaluate((city) => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.includes(city)) {
      const el = node.parentElement;
      const rect = el ? el.getBoundingClientRect() : null;
      out.push({
        tag: el ? el.tagName : "?",
        cls: el ? String(el.className).slice(0, 80) : "?",
        w: rect ? Math.round(rect.width) : -1,
        h: rect ? Math.round(rect.height) : -1,
        vis: el ? getComputedStyle(el).visibility : "?",
        disp: el ? getComputedStyle(el).display : "?",
      });
    }
  }
  return out;
}, CITY_FROM);
console.log("TEXT-NODES:", JSON.stringify(probe, null, 1));
const attempt = await page.getByText(CITY_FROM).first().waitFor({ timeout: 8000 }).then(() => "E2E-STYLE-OK").catch((e) => `E2E-STYLE-FAIL: ${e.message.split("\n")[0].slice(0, 160)}`);
console.log(attempt);
console.log("COUNT:", await page.getByText(CITY_FROM).count());
await browser.close();
