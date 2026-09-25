import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const TG_URL = process.env.E2E_TG_URL || "http://localhost:3012";
const CITY = `Е2Е-Проба-probe1`;
execFileSync("docker", ["exec", "edem-db-dev", "psql", "-U", "edem", "-d", "edem", "-tAc",
  `INSERT INTO "City" ("id","name","nameNormalized","createdAt","updatedAt") VALUES (gen_random_uuid(),'${CITY}','${CITY.toLowerCase()}',NOW(),NOW()) ON CONFLICT DO NOTHING`]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${TG_URL}/#/trips/my/new`, { waitUntil: "commit" });
try {
  const pre = page.getByRole("button", { name: "Принять и продолжить" });
  await pre.waitFor({ state: "visible", timeout: 8000 });
  await pre.click();
} catch {}
await page.getByLabel("Город отправления").waitFor({ timeout: 30000 });
await page.getByLabel("Город отправления").fill(CITY);
try {
  await page.getByText(CITY, { exact: true }).first().waitFor({ timeout: 10000 });
  console.log("DROPDOWN OK");
} catch (e) {
  console.log("DROPDOWN FAIL");
  const all = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("BODY:", JSON.stringify(all));
}
await browser.close();
execFileSync("docker", ["exec", "edem-db-dev", "psql", "-U", "edem", "-d", "edem", "-tAc",
  `DELETE FROM "City" WHERE "name"='${CITY}'`]);
