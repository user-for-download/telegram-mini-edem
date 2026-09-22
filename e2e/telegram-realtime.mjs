// Telegram realtime E2E (Playwright + Chromium, tg-migration-14, ws.v1)
// Проверяет TG WebSocket-клиент через перехват на уровне страницы
// (page.routeWebSocket): детерминированный fake-сервер, живой backend-WS
// не нужен. HTTP-bootstrap настоящий (dev-bypass hash=dev-hash).
//
// Проверяется:
// 1. handshake: первое сообщение — auth с JWT, в URL нет кредов/initData;
// 2. ping сервера → pong клиента;
// 3. booking:new → дедуплицированный нотис + refetch /trips/my;
// 4. повтор того же события — без второго нотиса (дедуп);
// 5. close 4401 → single-flight POST /auth/refresh + reconnect с новым токеном;
// 6. close 4403 → экран «Аккаунт заблокирован», без reconnect-loop и refresh.
//
// Prerequisites (см. e2e/README.md):
// - Telegram dev-сервер: `npm run dev:tg` (TG_BASE, default http://localhost:3012)
// - Backend: ALLOW_DEV_AUTH=true + dev DB (mockEnv даёт initData dev-hash,
//   бэкенд создаёт/находит юзера 9800001);
// - Playwright browsers: `npx playwright install chromium`.
//
// Env:
// - TG_BASE_URL (default http://localhost:3012)
// - E2E_VERBOSE=1 — подробные логи.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TG_BASE = process.env.TG_BASE_URL || "http://localhost:3012";
const VERBOSE = process.env.E2E_VERBOSE === "1";
const SHOTS = path.join(__dirname, "shots-realtime");

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let stepNo = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

async function runStep(name, fn) {
  stepNo++;
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
    return true;
  } catch (e) {
    record(name, false, String(e.message || e).split("\n").slice(0, 3).join(" ").slice(0, 300));
    return false;
  }
}

/** Ожидание условия с таймаутом (poll 100ms), без проглатывания ошибок шагов. */
async function waitFor(fn, timeoutMs, what) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, "0")}-${name}.png` });
  } catch (e) {
    if (VERBOSE) console.log(`  [shot] ${name} failed: ${String(e.message || e).slice(0, 120)}`);
    else throw e;
  }
}

// --- Fake WS-сервер (ws.v1): один обработчик на все соединения ---
const wsState = {
  connections: [], // { url, frames: [], resolvePong }
  authTokens: [],
  refreshRequests: 0,
};

function attachFakeWsServer(context) {
  return context.routeWebSocket("**/api/v1/ws", (route) => {
    const index = wsState.connections.length;
    const conn = { url: route.url(), frames: [] };
    wsState.connections.push(conn);
    if (VERBOSE) console.log(`  [ws] connection #${index}: ${conn.url}`);

    route.onMessage((message) => {
      let frame;
      try {
        frame = JSON.parse(message.text());
      } catch {
        conn.frames.push({ malformed: true });
        return;
      }
      conn.frames.push(frame);
      if (frame?.type === "auth" && typeof frame.token === "string") {
        wsState.authTokens.push(frame.token);
        route.send(JSON.stringify({ type: "auth:ok" }));
        // Только первому соединению — скриптованные keep-alive/события.
        if (index === 0) {
          setTimeout(() => {
            try {
              route.send(JSON.stringify({ type: "ping" }));
            } catch {
              // Соединение могли закрыть раньше ping — не валим прогон.
            }
          }, 300);
        }
      }
    });
    // Не вызываем connectToServer: сервер полностью замокан.
    conn.route = route;
  });
}

function findFrame(conn, predicate) {
  return conn.frames.find((frame) => !frame.malformed && predicate(frame));
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await attachFakeWsServer(context);
const page = await context.newPage();

// Подсчёт refresh-запросов клиента (шаги 4401/4403).
page.on("request", (request) => {
  if (request.url().includes("/api/v1/auth/refresh")) wsState.refreshRequests++;
});

let failed = 0;
const step = async (name, fn) => {
  if (!(await runStep(name, fn))) failed++;
};

try {
  await step("TG base доступен", async () => {
    const response = await fetch(`${TG_BASE}/`, { redirect: "manual" });
    if (!response.ok && response.status !== 304) {
      throw new Error(`TG dev server unreachable: HTTP ${response.status}`);
    }
    return TG_BASE;
  });

  await step("авторизация dev-bypass + онбординг", async () => {
    await page.goto(`${TG_BASE}/`, { waitUntil: "commit" });
    // Свежий dev-юзер 9800001 может упереться в онбординг: принимаем условия.
    const accept = page.getByRole("button", { name: "Принять и продолжить" });
    try {
      await accept.waitFor({ timeout: 8000 });
      await accept.click();
    } catch {
      // Онбординг уже принят ранее — идём дальше.
    }
    await page.getByText("Поиск").first().waitFor({ timeout: 20000 });
    return "authenticated";
  });

  await step("handshake: auth первым, без кредов в URL", async () => {
    const conn = await waitFor(() => wsState.connections[0], 15000, "ws connection");
    await waitFor(() => conn.frames.length > 0, 10000, "auth frame");
    if (conn.url.includes("?")) throw new Error(`credentials/query in WS URL: ${conn.url}`);
    if (/token|initData|auth_date|hash/i.test(conn.url)) {
      throw new Error(`credentials in WS URL: ${conn.url}`);
    }
    const first = conn.frames[0];
    if (first?.type !== "auth") throw new Error(`first frame is not auth: ${JSON.stringify(first)}`);
    if (typeof first.token !== "string" || first.token.length === 0) {
      throw new Error("auth frame has no JWT");
    }
    if ("initData" in first || /auth_date|hash/.test(JSON.stringify(first))) {
      throw new Error("initData leaked into auth frame");
    }
    return `url=${new URL(conn.url).pathname}`;
  });

  await step("ping сервера → pong клиента", async () => {
    const conn = wsState.connections[0];
    await waitFor(() => findFrame(conn, (f) => f.type === "pong"), 10000, "pong frame");
    return "pong received";
  });

  await step("booking:new → нотис + refetch /trips/my", async () => {
    const conn = wsState.connections[0];
    const tripsMy = page.waitForResponse(
      (response) => response.url().includes("/api/v1/trips/my") && response.request().method() === "GET",
      { timeout: 15000 },
    );
    conn.route.send(
      JSON.stringify({ type: "booking:new", payload: { bookingId: "e2e-b-1", tripId: "e2e-t-1" } }),
    );
    await page.getByText("Новая заявка на поездку").first().waitFor({ timeout: 10000 });
    await tripsMy;
    await shot(page, "booking-new-notice");
    return "notice + refetch ok";
  });

  await step("повтор события — дедуп (без второго нотиса)", async () => {
    const conn = wsState.connections[0];
    conn.route.send(
      JSON.stringify({ type: "booking:new", payload: { bookingId: "e2e-b-1", tripId: "e2e-t-1" } }),
    );
    await page.waitForTimeout(1500);
    const count = await page.getByText("Новая заявка на поездку").count();
    if (count !== 1) throw new Error(`duplicate notice rendered ${count} times`);
    if (wsState.connections.length !== 1) throw new Error("unexpected parallel socket");
    return "single notice, single socket";
  });

  await step("4401 → refresh + reconnect с новым токеном", async () => {
    const tokenBefore = wsState.authTokens[wsState.authTokens.length - 1];
    const refreshBefore = wsState.refreshRequests;
    wsState.connections[0].route.close({ code: 4401, reason: "Invalid token" });
    await page.waitForResponse(
      (response) => response.url().includes("/api/v1/auth/refresh"),
      { timeout: 15000 },
    );
    const second = await waitFor(() => wsState.connections[1], 20000, "reconnect");
    await waitFor(() => findFrame(second, (f) => f.type === "auth"), 10000, "auth on reconnect");
    const tokenAfter = wsState.authTokens[wsState.authTokens.length - 1];
    if (!tokenAfter || tokenAfter === tokenBefore) {
      throw new Error("reconnect did not present a rotated token");
    }
    if (wsState.refreshRequests - refreshBefore > 2) {
      throw new Error(`refresh storm: ${wsState.refreshRequests - refreshBefore} requests`);
    }
    return "reconnected with rotated token";
  });

  await step("4403 — терминально: бан-экран без reconnect-loop", async () => {
    const refreshBefore = wsState.refreshRequests;
    const connsBefore = wsState.connections.length;
    wsState.connections[connsBefore - 1].route.close({ code: 4403, reason: "Account is banned" });
    await page.getByText("Аккаунт заблокирован").first().waitFor({ timeout: 10000 });
    await shot(page, "banned-terminal");
    await page.waitForTimeout(5000);
    if (wsState.connections.length !== connsBefore) {
      throw new Error(`reconnect loop after 4403: ${wsState.connections.length} connections`);
    }
    if (wsState.refreshRequests !== refreshBefore) {
      throw new Error("refresh attempted after terminal 4403");
    }
    return "terminal, no loop";
  });
} finally {
  await browser.close();
}

console.log(`\nrealtime e2e: ${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
