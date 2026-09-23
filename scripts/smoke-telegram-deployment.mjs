// scripts/smoke-telegram-deployment.mjs — smoke Telegram-staging (tg-migration-20).
// Проверяет production-like стенд: health, готовность БД, Host-роутинг TG-ассетов,
// форму auth-ошибок, WS upgrade + auth-timeout, отсутствие VK-зависимости.
//
//   BACKEND_URL=http://staging-host:3000 TG_HOST=tg-edem.example.com node scripts/smoke-telegram-deployment.mjs
//
// Дефолты — локальный dev-стенд; Host-роутинг требует TELEGRAM_HOSTS с TG_HOST
// на сервере, иначе шаг честно падает (это и проверяется).
import { request as httpRequest } from "node:http";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3011";
const TG_HOST = process.env.TG_HOST || "";

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

async function get(path, { host } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: host ? { Host: host } : {},
  });
  const text = await res.text();
  return { status: res.status, text };
}

/**
 * GET с НАСТОЯЩИМ заголовком Host. fetch/undici выбрасывает Host как
 * forbidden header из fetch-спеки: запрос уходит с Host из URL и Host-роутинг
 * (TELEGRAM_HOSTS) проверить нельзя — шаг 3 ложно падал 404 на корректном
 * стенде. node:http заголовок отправляет как есть: соединение — на адрес
 * стенда, Host — целевого домена.
 */
function getWithHost(path, host) {
  const url = new URL(`${BACKEND_URL}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "GET",
        headers: { Host: host },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

let failed = 0;
const fail = (name, detail) => {
  check(name, false, detail);
  failed += 1;
};

// 1. Liveness.
try {
  const { status } = await get("/health/live");
  if (status === 200) check("health/live 200", true);
  else fail("health/live 200", `HTTP ${status}`);
} catch (e) {
  fail("health/live 200", `unreachable: ${e.message}`);
}

// 2. Readiness (DB + migrations applied).
try {
  const { status, text } = await get("/health/ready");
  if (status === 200) check("health/ready 200 (db+migrations)", true);
  else fail("health/ready 200 (db+migrations)", `HTTP ${status} ${text.slice(0, 120)}`);
} catch (e) {
  fail("health/ready 200 (db+migrations)", `unreachable: ${e.message}`);
}

// 3. Telegram host serving: index.html TG-стенда отличается от веб-версии:
// meta viewport с viewport-fit=cover обязателен для safe-area Telegram-вебвью
// (в webapp/index.html его нет). Латинских «telegram»-маркеров в TG-HTML не
// бывает — заголовок и тексты русские, поэтому прежняя проверка по строкам
// «telegram»/«tgWebApp» давала ложный red даже на верном Host-роутинге.
if (!TG_HOST) {
  fail("telegram host assets", "TG_HOST is not set — Host routing cannot be verified");
} else {
  try {
    const { status, text } = await getWithHost("/", TG_HOST);
    const looksTelegram = status === 200 && text.includes("viewport-fit=cover");
    if (looksTelegram) check("telegram host assets", true, TG_HOST);
    else fail("telegram host assets", `HTTP ${status}, no Telegram markers (TELEGRAM_HOSTS on server?)`);
  } catch (e) {
    fail("telegram host assets", `unreachable: ${e.message}`);
  }
}

// 4. Telegram auth endpoint exists (401/400/503 shape, never 404/500).
try {
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TG_HOST ? { Host: TG_HOST } : {}) },
    body: JSON.stringify({ initData: "hash=forged" }),
  });
  if ([400, 401, 503].includes(res.status)) {
    check("auth/telegram error shape", true, `HTTP ${res.status}`);
  } else {
    fail("auth/telegram error shape", `HTTP ${res.status} (expected 400/401/503)`);
  }
} catch (e) {
  fail("auth/telegram error shape", `unreachable: ${e.message}`);
}

// 5. VK independence: /auth/vk is removed (tg-migration-26) — the route must
// answer 404 with the JSON error shape, never 500, and no VK secret may be
// required to boot or operate.
try {
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/vk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TG_HOST ? { Host: TG_HOST } : {}) },
    body: JSON.stringify({ searchParams: "vk_user_id=1&vk_ts=1&sign=forged" }),
  });
  if (res.status === 404) {
    check("vk independence (route gone, 404 JSON)", true, `HTTP ${res.status}`);
  } else {
    fail("vk independence (route gone, 404 JSON)", `HTTP ${res.status}`);
  }
} catch (e) {
  fail("vk independence (route gone, 404 JSON)", `unreachable: ${e.message}`);
}

// 6. WebSocket upgrade + auth timeout: anonymous socket must be closed 4401
// within ~10s (AUTH_TIMEOUT 5s + margin), proving upgrade path through proxy.
try {
  const wsUrl = BACKEND_URL.replace(/^http/, "ws") + "/api/v1/ws";
  const outcome = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch { /* already closed */ }
      resolve({ opened: true, code: "timeout" });
    }, 12000);
    ws.addEventListener("open", () => {
      // Молчим: без auth-сообщения сервер должен закрыть сам.
    });
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({ opened: true, code: event.code });
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve({ opened: false, code: "error" });
    });
  });
  if (outcome.opened && outcome.code === 4401) {
    check("ws upgrade + auth timeout 4401", true, wsUrl);
  } else {
    fail("ws upgrade + auth timeout 4401", `open=${outcome.opened} code=${outcome.code}`);
  }
} catch (e) {
  fail("ws upgrade + auth timeout 4401", e.message);
}

if (failed > 0) {
  console.error(`\n⛔ Smoke failed: ${failed} check(s).`);
  process.exit(1);
}
console.log("\n✅ Smoke passed: Telegram staging is serving.");
