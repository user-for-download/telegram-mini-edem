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
  restoreDevStand,
  reviveDevUser,
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
reviveDevUser();
const { runStep, watchPage, collectRejections, verdict } = createHarness();

// Города — ДО запуска браузера: справочник городов кэшируется клиентом
// (useAllCitiesQuery, staleTime Infinity), и сид после первого рендера
// любой страницы с городами в дропдаун уже не попадает.
const { fromId: seedFromId, toId: seedToId } = seedCities();

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
  // Идемпотентно: остаток прошлого упавшего прогона не валит сид
  // (nameNormalized @unique) — добираем id селектом.
  const ensure = (name) => {
    psql(
      `INSERT INTO "City" ("id", "name", "nameNormalized", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${name}', '${norm(name)}', NOW(), NOW()) ON CONFLICT ("nameNormalized") DO NOTHING`,
    );
    const id = psql(`SELECT "id" FROM "City" WHERE "name" = '${name}'`)
      .split("\n")[0]
      .trim();
    if (!id) throw new Error("city seed failed");
    return id;
  };
  return { fromId: ensure(CITY_FROM), toId: ensure(CITY_TO) };
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
    const preAccept = page.getByRole("button", { name: "Я согласен" });
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
    const acceptBtn = page.getByRole("button", { name: "Я согласен" });
    try {
      await acceptBtn.waitFor({ state: "visible", timeout: 15000 });
      await acceptBtn.click();
    } catch {
      // Уже принят ранее — идём дальше.
    }
    await page.getByText("Dev Telegram").first().waitFor({ timeout: 60000 });
    return `tgId=${DEV_TG_ID}`;
  });

  await runStep("prereq: дев-юзеру включены уведомления", async () => {
    // notification.service.ts:207 глушит непрочитанные уведомления, если у
    // юзера они выключены (кроме критичных). Стандартный дев-юзер ходит с
    // выключенными — это состояние сида, а не дефект приложения. Поэтому шаг
    // «inbox показывает новую заявку» падал не из-за кода, а из-за
    // предусловия, которое тест не выставлял: проходил он только если уведомления
    // уже были включены кем-то до него. Выглядело это как флак, хотя шаг был
    // детерминированным.
    // Намеренно НЕ в reviveDevUser(): там ремонтируют сломанный стенд, а
    // предусловие проверки обязано быть видно в теле сценария.
    //
    // ВАЖНО: шаг стоит ДО создания поездки и брони, а не рядом с проверкой
    // инбокса. Глушение происходит в момент СОЗДАНИЯ уведомления, поэтому
    // включение после брони уже ничего не создаёт — шаг был бесполезен.
    await hashUrl(page, "/settings");
    // Модалка ещё не смонтирована сразу после hashUrl, а count() по
    // неотрендеренному DOM даёт 0 — это читалось как «уже включены».
    await page
      .getByRole("button", { name: /^(Включить уведомления|Выключить некритичные)$/ })
      .first()
      .waitFor({ timeout: 30000 });
    const off = page.getByRole("button", { name: /^Включить уведомления$/ });
    if (await off.count()) {
      await off.click();
      await page
        .getByRole("button", { name: /^Выключить некритичные$/ })
        .waitFor({ timeout: 30000 });
      return "были выключены → включили";
    }
    return "уже включены";
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
        fromCityId: seedFromId,
        toCityId: seedToId,
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
    // Города выбираются из справочника селектом (решение владельца
    // 2026-10-03). Раньше здесь был китовский Multiselect и шаг печатал имя,
    // затем кликал ячейку дропдауна с `force` (её перекрывал state-layer
    // кита). С нативным селектом всё это не нужно: selectOption по id.
    await page.getByLabel("Город отправления").selectOption(seedFromId);
    await page.getByLabel("Город назначения").selectOption(seedToId);
    // datetime-local: формат YYYY-MM-DDTHH:mm.
    const dep = new Date(Date.now() + 86400e3);
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T${pad(dep.getHours())}:${pad(dep.getMinutes())}`;
    await page.locator('input[type="datetime-local"]').fill(local);
    await page.getByLabel("Расстояние, км").fill("180");
    await page.getByLabel("Цена, ₽").fill(String(PRICE));
    // Места — нативный селект 1..3 (дефолт 1): выбираем 3. Степпера с
    // кнопками «Больше мест» больше нет — заменён Select (1fde25f), и сценарий
    // всё ещё ждал ту кнопку: поездка не создавалась, а дальше падал каскад
    // из восьми шагов (бронь 404, «Принять», уведомления, отзыв).
    await page.getByLabel("Места").selectOption("3");
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
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "create-trip")}`, { cause: e });
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
    // Тап по баннеру: непрочитанную помечает прочитанной и уходит по маршруту
    // заявки (кнопок в карточке нет — паттерн NotificationBanner).
    await hashUrl(page, "/notifications");
    // Баннер ищем по МАРШРУТУ этого прогона (имена городов уникальны на прогон),
    // а не по общему заголовку «Новая заявка»: у дев-юзера сид держит своё
    // непрочитанное «Новая заявка на место» (Вологда → Череповец), и первый
    // по порядку — не обязательно наша. Замер: имя баннера содержит актора и
    // маршрут, так что адресация точная.
    const banner = page.getByRole("button", { name: new RegExp(CITY_FROM) }).first();
    await banner.waitFor({ timeout: 30000 });
    const counterBefore = Number(
      (await page.getByRole("button", { name: /^Прочитать все \((\d+)\)$/ })
        .getAttribute("aria-label"))?.match(/\((\d+)\)/)?.[1] ?? "0",
    );
    await banner.click();
    // Уход со страницы доказывает markRead+навигацию: ждём заявки водителя.
    await page.getByText("Заявки").first().waitFor({ timeout: 15000 });
await shot(page, "notification-read");
    // Возврат: заявка прочитана — в «Новых» её больше нет.
    // Проверяем ИМЕННО её отсутствие, а не пустоту списка: к этому моменту в
    // «Новых» лежат и другие непрочитанные (прогон уже создал поездку,
    // подтвердил заявку и получил WS-события), так что «Пока нет уведомлений»
    // здесь никогда не появляется — это был неверный критерий.
    //
    // Без reload: раньше запись возвращалась при переходе по хэшу, потому что
    // markRead инвалидировал кэш только в onError. Теперь onSuccess
    // инвалидирует lists(), и возврат показывает серверное состояние — на этом
    // и держится шаг (reload тут был бы обходом, скрывающим возврат бага).
    await hashUrl(page, "/notifications");
    await page.waitForTimeout(1200);
    // Критерий — счётчик непрочитанных: он авторитетный и не зависит от того,
    // сколько одноимённых записей в инбоксе. Наш баннер должен уйти из «Новых».
    const counterAfter = Number(
      (await page.getByRole("button", { name: /^Прочитать все \((\d+)\)$/ })
        .getAttribute("aria-label"))?.match(/\((\d+)\)/)?.[1] ?? "0",
    );
    if (counterAfter !== counterBefore - 1) {
      throw new Error(
        `счётчик не уменьшился на 1: было ${counterBefore}, стало ${counterAfter}`,
      );
    }
    if (await page.getByRole("button", { name: new RegExp(CITY_FROM) }).count()) {
      throw new Error("прочитанная заявка осталась в «Новых»");
    }
    return `booking_created read (счётчик ${counterBefore} → ${counterAfter})`;
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
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "refresh")}`, { cause: e });
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
    // Завершение живёт в деталях поездки (карточка списка ведёт тапом по
    // onOpen, отдельной кнопки «Завершить» в ленте больше нет).
    await hashUrl(page, `/trips/${tripId}`);
    try {
      await page
        .getByRole("button", { name: "Завершить поездку" })
        .click({ timeout: 30000 });
    } catch (e) {
      throw new Error(`${e.message.split("\n")[0]} | ${await diagnose(page, "complete-details")}`, { cause: e });
    }
    // После завершения детали показывают терминальный экран статуса.
    await page.getByText("Поездка завершена").first().waitFor({ timeout: 30000 });
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
    // Форма обращения живёт во всплывающем окне: страница показывает FAQ и
    // историю, а написать новое — кнопка под списком «Мои обращения».
    await page.getByRole("button", { name: "Создать обращение" }).click();
    await page.locator("#support-subject").fill("Нет уведомления");
    await page.locator("#support-text").fill(FEEDBACK_TEXT);
    // «Отправить» есть и в других окнах — целимся в это, по видимым полям.
    await page
      .locator('[role="dialog"]')
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
    // Модалка отдаёт ОДНО действие, и подпись зависит от состояния:
    // «Включить уведомления» (выключены) либо «Выключить некритичные»
    // (включены). Шаг и раньше был записан по другой форме UI: он кликал
    // «Выключить некритичные» на старте, где такой кнопки нет, и вторым
    // кликом ждал «Включить уведомления» — то есть порядок был обратным.
    // Состояние берём из DOM, а не задаём: оно живёт в dev-БД и переживает
    // прогон, поэтому фиксировать стартовое значение нельзя.
    const OFF = /^Включить уведомления$/;
    const ON = /^Выключить некритичные$/;
    // То же ожидание, что в prereq: без него isOn читался как 0 на
    // ещё не смонтированной модалке, и шаг кликал несуществующую кнопку.
    await page
      .getByRole("button", { name: /^(Включить уведомления|Выключить некритичные)$/ })
      .first()
      .waitFor({ timeout: 30000 });
    const isOn = await page.getByRole("button", { name: ON }).count();
    const first = isOn ? ON : OFF;
    const second = isOn ? OFF : ON;

    await page.getByRole("button", { name: first }).click();
    // Сигнал, что мутация доехала, — подпись стала противоположной. Он и есть
    // проверка round-trip; тост после второго клика уже ничего не добавляет, а
    // ожидание его скрытия перед вторым кликом делало шаг хрупким: окно между
    // «тост ушёл» и «клик» в 30 секунд успело застать состояние, которое
    // меняет refetch.
    await page.getByRole("button", { name: second }).waitFor({ timeout: 30000 });
    await page.getByText("Настройки сохранены").waitFor({ timeout: 30000 });

    await page.getByRole("button", { name: second }).click();
    await page.getByRole("button", { name: first }).waitFor({ timeout: 30000 });
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
      // Город выбирается из справочника (решение владельца 2026-10-03), а не
      // печатается: поле стало нативным селектом, fill() по id не работает.
      await page.locator("#search-from").selectOption(seedFromId);
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
    // ConfirmPopup: в браузер-моке (dev) действие выполняется сразу —
    // нативного popup в браузере нет, второго клика «Удалить окончательно».
    // В реальном Telegram это нативный алерт [Отмена | красная].
    await page.getByRole("button", { name: "Удалить профиль" }).click();
    // Именно заголовок, а не getByText: текст «Профиль удалён» есть и в h1
    // экрана, и в dt внутри пустого состояния, и getByText без .first()
    // падал на strict mode violation («resolved to 2 elements»).
    await page.getByRole("heading", { name: "Профиль удалён" }).waitFor({ timeout: 30000 });
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
    // Стенд восстанавливаем ПОСЛЕ уборки прогона, а не до: сид делает полный
    // сброс с пересборкой и вернул бы только что вычищенное обратно. Шаг
    // удаления профиля стирает уведомления u-dev (DELETE /me чистит их по
    // контракту), а reviveDevUser() чинит только строку пользователя — без
    // сида после прогона у дев-юзера оставалось 0 уведомлений вместо 9.
    restoreDevStand();
    console.log("🌱 стенд восстановлен сидом");
  } catch (e) {
    console.error(`⛔ Cleanup failed: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await browser?.close();
    if (!verdict()) process.exitCode = 1;
  }
}
