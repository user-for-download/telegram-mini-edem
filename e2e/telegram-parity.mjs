// e2e/telegram-parity.mjs — Telegram Mini App parity E2E (Playwright + Chromium).
// Водитель (UI, мокнутый dev-юзер 9800001) создаёт поездку → контрагент (API,
// свой JWT через тот же dev-bypass) бронирует → водитель подтверждает в UI →
// уведомления, завершение, отзыв, поддержка, настройки, удаление.
//
// Детерминизм (skill playwright-e2e, зеркально full-cycle.mjs):
// - уникальные данные на запуск (PRICE/RUN_ID/тексты) — повторы не конфликтуют;
// - cleanup в finally (pass и fail), неудача чистки валит прогон;
// - pageerror/unhandledrejection валят прогон;
// - BASE/API/DB/ADMIN — через env; time-travel departure через docker psql.
import { chromium } from "playwright";
import {
  API_URL,
  DEV_TG_ID,
  PEER_TG_ID,
  PRICE,
  PRICE_LABEL,
  RUN_ID,
  SHOTS,
  TG_URL,
  api,
  checkPrereqs,
  cleanupRun,
  createHarness,
  ensureShotsDir,
  psql,
  tgApiLogin,
} from "./telegram-fixtures.mjs";

const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN || "dev-admin-token-12345";
const REVIEW_TEXT = `Отличная поездка ${RUN_ID}, приятный водитель!`;
const FEEDBACK_TEXT = `Паритет-проверка ${RUN_ID}: не приходит уведомление.`;
const ADMIN_REPLY = `Паритет-ответ ${RUN_ID}: проверьте inbox.`;
const CITY_FROM = `Е2Е-Москва-${RUN_ID}`;
const CITY_TO = `Е2Е-Тула-${RUN_ID}`;

ensureShotsDir();
checkPrereqs();
const { runStep, watchPage, collectRejections, verdict } = createHarness();

let tripId = "";
let peerTripId = "";
let peerUserId = "";
let peerToken = "";
let driverUserId = "";
let feedbackId = "";
let adminCookie = "";
let browser = null;

function hashUrl(page, hash) {
  return page.goto(`${TG_URL}/#${hash}`, { waitUntil: "commit" });
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Диагностика упавшего шага: скрин + первые 500 символов видимого текста. */
async function diagnose(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/fail-${name}.png` });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 500));
    return `screen=fail-${name}.png text=${JSON.stringify(text.slice(0, 200))}`;
  } catch {
    return "diagnose failed";
  }
}

/** Города справочника напрямую в БД (для UI-датиста). Возвращает id. */
function seedCities() {
  const norm = (s) => s.trim().toLowerCase();
  // INSERT..RETURNING печатает значение + тег «INSERT 0 1» — берём первую строку.
  const firstLine = (output) => output.split("\n")[0].trim();
  const fromId = firstLine(psql(
    `INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_FROM}', '${norm(CITY_FROM)}', NOW(), NOW()) RETURNING "id"`,
  ));
  const toId = firstLine(psql(
    `INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${CITY_TO}', '${norm(CITY_TO)}', NOW(), NOW()) RETURNING "id"`,
  ));
  if (!fromId || !toId) throw new Error("city seed failed");
  return { fromId, toId };
}

function deleteCities() {
  psql(`DELETE FROM "City" WHERE "name" IN ('${CITY_FROM}', '${CITY_TO}')`);
}

try {
  browser = await chromium.launch();
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await desktop.newPage();
  await watchPage(page, "desktop");
  page.on("dialog", (dialog) => void dialog.accept());

  // Холодный старт: свежий vite компилируется десятки секунд — один
  // незасчитанный прогрев с длинным ожиданием (паттерн full-cycle.mjs).
  await page.goto(`${TG_URL}/`, { waitUntil: "commit" });
  await page
    .getByText(/Найти поездку|Добро пожаловать/)
    .first()
    .waitFor({ timeout: 120000 });

  await runStep("prereq: TG-front отдаёт приложение", async () => {
    await hashUrl(page, "/trips");
    // На чистой БД первым встречает онбординг-гейт — принимаем сразу здесь.
    const preAccept = page.getByRole("button", { name: "Принять и продолжить" });
    try {
      await preAccept.waitFor({ state: "visible", timeout: 10000 });
      await preAccept.click();
    } catch {
      // Онбординг уже принят — идём дальше.
    }
    await page.getByText("Поиск попутных поездок").first().waitFor({ timeout: 30000 });
    return TG_URL;
  });

  await runStep("auth: dev-вход, профиль Dev Telegram", async () => {
    await hashUrl(page, "/profile");
    // Онбординг — гейт поверх всех роутов: сначала принимаем его.
    const acceptBtn = page.getByRole("button", { name: "Принять и продолжить" });
    try {
      await acceptBtn.waitFor({ state: "visible", timeout: 15000 });
      await acceptBtn.click();
    } catch {
      // Уже принят ранее — идём дальше.
    }
    await page.getByText("Dev Telegram").first().waitFor({ timeout: 60000 });
    return `tgId=${DEV_TG_ID}`;
  });

  await runStep("setup: машина водителя + города + контрагент", async () => {
    // Один вход на сущность за прогон: /auth/telegram лимитирован IP
    // (дефолт 5/5мин, общий для UI и API) — повторные входы его съедают
    // и ломают рераны. Машина — через psql (upsert), токен контрагента
    // переиспользуется во всех API-ногах ниже.
    const devRow = psql(
      `SELECT "id" FROM "User" WHERE "telegramUserId" = ${DEV_TG_ID}`,
    );
    if (!devRow) throw new Error("dev user missing after auth");
    driverUserId = devRow;
    psql(
      `INSERT INTO "Car" ("id", "userId", "model", "color") VALUES (gen_random_uuid(), '${driverUserId}', 'Lada Vesta', 'белый') ON CONFLICT ("userId") DO NOTHING`,
    );
    const { fromId, toId } = seedCities();
    const peer = await tgApiLogin(PEER_TG_ID, "Peer");
    peerUserId = peer.userId;
    peerToken = peer.accessToken;
    // Машина + своя поездка контрагента (для mobile-поиска чужой карточки:
    // собственные поездки поиск может скрывать).
    psql(
      `INSERT INTO "Car" ("id", "userId", "model", "color") VALUES (gen_random_uuid(), '${peerUserId}', 'Kia Rio', 'серый') ON CONFLICT ("userId") DO NOTHING`,
    );
    const dep = new Date(Date.now() + 86400e3).toISOString();
    const peerTrip = await api("/trips", {
      method: "POST",
      token: peerToken,
      body: {
        fromCity: CITY_FROM,
        fromAddress: "пл. Ленина",
        toCity: CITY_TO,
        toAddress: "ул. Советская",
        fromCityId: fromId,
        toCityId: toId,
        departureAt: dep,
        durationMinutes: 150,
        distanceKm: 180,
        price: PRICE + 1,
        seatsTotal: 3,
        tags: [],
      },
    });
    peerTripId = peerTrip.id;
    return `peer=${peerUserId.slice(0, 8)}`;
  });

  await runStep("create trip: UI публикует поездку с уникальной ценой", async () => {
    await hashUrl(page, "/trips/my/new");
    // Multiselect: печатаем и кликаем ячейку дропдауна по точному тексту
    // (у опций tgui нет role=option — только у выбранных чипов).
    await page.getByLabel("Город отправления").fill(CITY_FROM);
    await page.getByText(CITY_FROM, { exact: true }).first().click();
    await page.getByLabel("Город назначения").fill(CITY_TO);
    await page.getByText(CITY_TO, { exact: true }).first().click();
    // datetime-local: формат YYYY-MM-DDTHH:mm.
    const dep = new Date(Date.now() + 86400e3);
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T${pad(dep.getHours())}:${pad(dep.getMinutes())}`;
    await page.locator('input[type="datetime-local"]').fill(local);
    await page.getByLabel("Расстояние, км").fill("180");
    await page.getByLabel("Цена, ₽").fill(String(PRICE));
    // Места — степпер 1..3 (дефолт 1): два клика «Больше мест» → 3.
    const moreSeats = page.getByRole("button", { name: "Больше мест" });
    await moreSeats.click();
    await moreSeats.click();
    await page.getByRole("button", { name: "Опубликовать" }).click();
    // Успех — редирект на /trips/:id.
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/, { timeout: 30000 });
    tripId = page.url().match(/[0-9a-f-]{36}$/)[0];
    // Водитель на своей странице цены не видит (цена — только в canBook-блоке
    // пассажира): ждём блок управления + сверяем цену через API.
    // NB: Shell держит предыдущий роут смонтированным в hidden-контейнере
    // (aria-hidden + hidden) ради анимации/бэка — там лежит карточка этой же
    // поездки из списка, поэтому .first() без фильтра упирается в невидимую
    // копию. Фильтруем только видимые (заголовок Timeline на странице деталей).
    try {
      await page.getByText("Управление поездкой").first().waitFor({ timeout: 15000 });
      await page.getByText(CITY_FROM).filter({ visible: true }).first().waitFor({ timeout: 15000 });
    } catch (e) {
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "create-trip")}`);
    }
    const created = await api(`/trips/${tripId}`, { token: peerToken });
    if (created.price !== PRICE) {
      throw new Error(`price mismatch: API ${created.price} !== UI ${PRICE}`);
    }
    await shot(page, "trip-created");
    return `trip=${tripId.slice(0, 8)} price=${PRICE_LABEL}`;
  });

  await runStep("booking: контрагент бронирует через API", async () => {
    const booking = await api("/bookings", {
      method: "POST",
      token: peerToken,
      body: { tripId, seat: 1 },
    });
    if (!booking.id) throw new Error("booking id missing");
    return `booking=${booking.id.slice(0, 8)}`;
  });

  await runStep("approve: водитель принимает заявку в UI", async () => {
    await hashUrl(page, `/trips/my/${tripId}/requests`);
    await page.getByRole("button", { name: "Принять" }).click();
    await page.getByText("Подтверждён").first().waitFor({ timeout: 30000 });
    await shot(page, "booking-confirmed");
    return "status=confirmed";
  });

  await runStep("notifications: inbox показывает новую заявку", async () => {
    await hashUrl(page, "/notifications");
    await page.getByText("Новая заявка").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Отметить прочитанным" }).first().click();
    await page.getByText("Новая заявка").first().waitFor({ timeout: 15000 });
    return "booking_created read";
  });

  await runStep("refresh: перезагрузка сохраняет состояние заявок", async () => {
    // Явно возвращаемся на заявки (предыдущий шаг был в уведомлениях),
    // затем reload — ждём серверный ресинк подтверждённой заявки.
    await hashUrl(page, `/trips/my/${tripId}/requests`);
    await page.getByText("Подтверждён").first().waitFor({ timeout: 30000 });
    await page.reload({ waitUntil: "commit" });
    try {
      await page.getByText("Подтверждён").first().waitFor({ timeout: 60000 });
    } catch (e) {
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "refresh")}`);
    }
    return "resync ok";
  });

  await runStep("reconnect: offline-баннер и восстановление", async () => {
    // finally гарантирует возврат online: зависший offline валит каскадом
    // все последующие шаги (наблюдалось).
    await desktop.setOffline(true);
    try {
      // Баннер рендерится и в Shell, и на странице — берём первый.
      await page.getByTestId("offline-banner").first().waitFor({ timeout: 15000 });
      await page.getByText("Нет подключения").first().waitFor({ timeout: 15000 });
    } finally {
      await desktop.setOffline(false);
    }
    // Баннер не прячется, а переключается на подтверждение восстановления.
    await page.getByText("Соединение восстановлено").first().waitFor({ timeout: 30000 });
    await page.getByText("Подтверждён").first().waitFor({ timeout: 30000 });
    return "ws resync ok";
  });

  await runStep("complete: time-travel + завершение в UI", async () => {
    const out = psql(
      `UPDATE "Trip" SET "departureAt" = NOW() - INTERVAL '2 hours' WHERE id = '${tripId}'`,
    );
    if (out !== "UPDATE 1") throw new Error(`time-travel: ${out}`);
    // Поездки водителя — сегмент «За рулём» объединённого таба «Поездки».
    await hashUrl(page, "/bookings?segment=driver");
    const finishButtons = page.getByRole("button", { name: "Завершить" });
    try {
      await finishButtons.first().click({ timeout: 30000 });
    } catch (e) {
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "complete-list")}`);
    }
    await page
      .getByText("Поездка будет перенесена в архив")
      .waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Завершить" }).last().click();
    // Завершённая поездка остаётся в списке водителя с пилюлей «Завершена».
    await page.getByText("Завершена").first().waitFor({ timeout: 30000 });
    await shot(page, "trip-completed");
    return "status=completed";
  });

  // Админ входим один раз за прогон (лимит логина общий для IP).
  async function adminAuth() {
    if (adminCookie) return adminCookie;
    const loginRes = await fetch(`${API_URL}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    });
    if (!loginRes.ok) throw new Error(`admin login: HTTP ${loginRes.status}`);
    const match = (loginRes.headers.get("set-cookie") || "").match(/edem_admin_jwt=([^;]+)/);
    if (!match) throw new Error("admin cookie missing");
    adminCookie = `edem_admin_jwt=${match[1]}`;
    return adminCookie;
  }

  await runStep("review: отзыв контрагента + модерация, виден в UI", async () => {
    const review = await api("/reviews", {
      method: "POST",
      token: peerToken,
      body: { tripId, targetUserId: driverUserId, rating: 5, text: REVIEW_TEXT },
    });
    // Модерация через admin-API.
    const cookie = await adminAuth();
    const approveRes = await fetch(`${API_URL}/admin/reviews/${review.id}/approve`, {
      method: "PATCH",
      headers: { Cookie: cookie },
    });
    if (!approveRes.ok) {
      throw new Error(`approve: HTTP ${approveRes.status} ${(await approveRes.text()).slice(0, 200)}`);
    }
    await hashUrl(page, "/reviews");
    // Полученные отзывы — на вкладке «Обо мне» (дефолт — «Мои»).
    // SegmentedControl рендерит табы с role="tab" (tgui), не кнопки.
    await page.getByRole("tab", { name: "Обо мне" }).click();
    await page.getByText(REVIEW_TEXT).first().waitFor({ timeout: 30000 });
    return "published visible";
  });

  await runStep("support: обращение в UI + ответ админа виден", async () => {
    await hashUrl(page, "/profile/support");
    await page.locator("#support-subject").fill("Нет уведомления");
    await page.locator("#support-text").fill(FEEDBACK_TEXT);
    // На странице две кнопки «Отправить» (запрос попутчика + поддержка) —
    // целимся в секцию «Связаться с нами».
    await page
      .locator("section", { hasText: "Связаться с нами" })
      .getByRole("button", { name: "Отправить" })
      .click();
    await page.getByText("Обращение отправлено").waitFor({ timeout: 30000 });
    const row = psql(`SELECT "id" FROM "Feedback" WHERE "text" = '${FEEDBACK_TEXT}'`);
    if (!row) throw new Error("feedback row missing");
    feedbackId = row;
    const cookie = await adminAuth();
    const replyRes = await fetch(`${API_URL}/admin/feedback/${feedbackId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ reply: ADMIN_REPLY }),
    });
    if (!replyRes.ok) throw new Error(`reply: HTTP ${replyRes.status}`);
    await page.reload({ waitUntil: "commit" });
    // Карточка свернута: раскрываем по теме, внутри — «Ответ поддержки».
    await page.getByRole("button", { name: /Нет уведомления/ }).click();
    await page.getByText("Ответ поддержки").first().waitFor({ timeout: 30000 });
    await page.getByText(ADMIN_REPLY).first().waitFor({ timeout: 15000 });
    return "reply visible";
  });

  await runStep("settings: тумблер уведомлений туда-обратно", async () => {
    await hashUrl(page, "/settings");
    await page.getByRole("button", { name: "Выключить некритичные" }).click();
    await page.getByText("Настройки сохранены").waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Включить уведомления" }).click();
    await page.getByText("Настройки сохранены").waitFor({ timeout: 30000 });
    return "toggle round-trip ok";
  });

  await runStep("deeplink: мусорный маршрут падает на главную", async () => {
    await hashUrl(page, "/no-such-route-xyz");
    await page.getByText("Найти поездку").first().waitFor({ timeout: 30000 });
    return "fallback=/";
  });

  await runStep("mobile: 390px — поиск и карточка поездки", async () => {
    // Ресайз в том же контексте вместо нового: новый контекст = новый
    // bootstrap = лишний /auth/telegram из общего IP-бюджета (5/5мин).
    // Раскладка при 390px проверяется тем же рендером.
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await hashUrl(page, "/trips");
      await page.getByText("Поиск попутных поездок").first().waitFor({ timeout: 30000 });
      // Ищем по городу отправления — карточка ЧУЖОЙ поездки (контрагент,
      // PRICE+1): свои поиск скрывает.
      await page.locator("#search-from").fill(CITY_FROM);
      await page.getByRole("button", { name: "Найти" }).click();
      await page.getByText(`${PRICE + 1} ₽`).first().waitFor({ timeout: 30000 });
      await shot(page, "mobile-search");
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    return "viewport=390x844";
  });

  await runStep("delete: удаление профиля в UI, экран «Профиль удалён»", async () => {
    await hashUrl(page, "/profile");
    await page.getByRole("button", { name: "Удалить профиль" }).click();
    // ConfirmAction: первый клик вооружает (без window.confirm), второй — подтверждает.
    await page.getByRole("button", { name: "Удалить окончательно" }).click();
    await page.getByText("Профиль удалён").waitFor({ timeout: 30000 });
    await shot(page, "account-deleted");
    return "tombstone shown";
  });

  await collectRejections(page, "desktop");
  await desktop.close();
} catch (e) {
  console.error(`⛔ Fatal: ${e.message}`);
  process.exitCode = 2;
} finally {
  try {
    await cleanupRun({ tripIds: [tripId, peerTripId], peerUserId, feedbackTexts: [FEEDBACK_TEXT] });
    deleteCities();
    console.log("🧹 cleanup ok");
  } catch (e) {
    console.error(`⛔ Cleanup failed: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await browser?.close();
    if (!verdict()) process.exitCode = 1;
  }
}
