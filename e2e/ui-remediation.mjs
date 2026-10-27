// Task22: fixture-only acceptance. Run against Vite, never against a backend/DB.
// node e2e/ui-remediation.mjs; E2E_UI_FULL=1 node e2e/ui-remediation.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import * as contracts from '@edem/contracts';

const BASE = (process.env.E2E_TG_URL || 'http://localhost:3012').replace(/\/$/, '');
const OUT = '/tmp/opencode/telegram-ui-remediation';
const FILTER = process.env.E2E_UI_FILTER ? new RegExp(process.env.E2E_UI_FILTER) : null;
const NOW = new Date('2026-10-24T09:00:00.000Z');
// Contract refinements also consult new Date() in Node, not just in Chromium.
const SystemDate = Date;
globalThis.Date = class extends SystemDate {
  constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
  static now() { return NOW.getTime(); }
};
const FUTURE = '2026-11-06T09:00:00.000Z';
const LATEST = '2026-11-08T18:00:00.000Z';
const PAST = '2026-10-23T09:00:00.000Z';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = { me: uuid(1), peer: uuid(2), free: uuid(10), pending: uuid(11), confirmed: uuid(12), own: uuid(13), emptyOwn: uuid(14), history: uuid(15), request: uuid(20) };
const VERSION = (await readFile(new URL('../telegram-app/src/onboarding/version.ts', import.meta.url), 'utf8')).match(/ONBOARDING_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
assert.ok(VERSION, 'Read the current onboarding version, do not silently guess it');
const kitRoot = await readFile(new URL('../node_modules/@telegram-apps/telegram-ui/dist/components/Service/AppRoot/AppRoot.js', import.meta.url), 'utf8');
const IOS_ROOT_CLASS = kitRoot.match(/platform\s*===\s*['"]ios['"]\s*&&\s*['"]([^'"]+)['"]/)?.[1];
assert.ok(IOS_ROOT_CLASS, 'Discover the iOS marker from the installed kit, never hardcode a versioned class');
const NAME = ('Александра Константиновна Доброжелательная ').repeat(3).slice(0, 99) + 'А';
const OTHER_NAME = NAME.slice(0, 99) + 'Б';
const COMMENT = ('Спокойная поездка, чистый салон, остановка у вокзала. ').repeat(11).slice(0, 500);
const avatar = `${BASE}/__ui-remediation-avatar.svg`;
const cities = [{ id: uuid(30), name: 'Вологда' }, { id: uuid(31), name: 'Череповец' }, { id: uuid(32), name: 'Нижний Новгород' }];
const user = (id, name) => ({ id, name, avatar, rating: 4.8, reviewsCount: 101, tripsCount: 123, isVerified: true, createdAt: PAST, about: 'Синтетический профиль для проверки интерфейса.', car: { model: 'Skoda Octavia', color: 'серебристый' } });
const me = { ...user(IDS.me, 'Тестовый Пользователь'), onboardingVersion: VERSION, notificationsEnabled: true };
const peer = user(IDS.peer, NAME);
const trip = (id, overrides = {}) => ({ id, fromCity: cities[0].name, toCity: cities[1].name, fromCityId: cities[0].id, toCityId: cities[1].id, date: '2026-11-06', time: '12:00', departureAt: FUTURE, durationMinutes: 110, distanceKm: 180, price: 100000, seatsTotal: 3, seatsAvailable: 3, driver: peer, tags: ['Тихая поездка', 'Не курить', 'Есть багаж'], comment: COMMENT, status: 'active', autoComplete: false, matchingEnabled: true, myBooking: null, ...overrides });
const booking = (id, t, passenger = me, status = 'pending') => ({ id, trip: t, passenger, seat: 1, status, expiresAt: LATEST, comment: 'Небольшой рюкзак, буду вовремя.' });
const request = { id: IDS.request, fromCity: cities[0], toCity: cities[1], earliestAt: FUTURE, latestAt: LATEST, seats: 3, status: 'active', expiresAt: LATEST, createdAt: PAST, updatedAt: PAST };
const review = { id: uuid(40), author: peer, targetRole: 'driver', rating: 5, text: 'Синтетический отзыв: всё прошло спокойно.', status: 'published', date: '2026-10-23', tripRoute: 'Вологда → Череповец' };
const report = { id: uuid(41), targetType: 'trip', targetId: IDS.history, category: 'other', description: 'Синтетическое описание для проверки.', status: 'resolved', resolutionNote: 'Синтетический ответ модерации.', createdAt: PAST, updatedAt: PAST, resolvedAt: PAST };
const feedback = { id: uuid(42), subject: 'Синтетическое обращение', text: 'Синтетическое сообщение, без личных данных.', reply: 'Синтетический ответ поддержки.', repliedAt: PAST, createdAt: PAST };
const notification = { id: uuid(43), userId: IDS.me, type: 'booking_status_changed', title: 'Бронь подтверждена', body: 'Синтетическое событие.', isRead: false, deepLink: `/trips/${IDS.confirmed}`, actorName: NAME, action: 'confirmed', tripFrom: cities[0].name, tripTo: cities[1].name, tripPrice: 100000, tripDepartureAt: FUTURE, createdAt: PAST };
const offset = (items, page = 1, limit = 20) => ({ items: items.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: items.length, totalPages: Math.ceil(items.length / limit), hasMore: page * limit < items.length } });
const cursor = (items, value = null, limit = 50) => {
  const start = value ? items.findIndex(item => item.id === value) + 1 : 0;
  assert.ok(!value || start > 0, `Unknown fixture cursor ${value}`);
  const slice = items.slice(start, start + limit), hasMore = start + limit < items.length;
  return { items: slice, pagination: { nextCursor: hasMore ? slice.at(-1).id : null, hasMore, limit } };
};
const checked = (name, value) => {
  assert.ok(contracts[name]?.parse, `Installed @edem/contracts lacks ${name}; build contracts first`);
  contracts[name].parse(value);
  return value; // Keep read-only enrichment, rather than Zod-stripping it.
};

function fixtures() {
  const trips = new Map([
    [IDS.free, trip(IDS.free)],
    [IDS.pending, trip(IDS.pending, { seatsAvailable: 2, myBooking: { id: uuid(50), seat: 1, status: 'pending' } })],
    [IDS.confirmed, trip(IDS.confirmed, { seatsAvailable: 2, myBooking: { id: uuid(51), seat: 2, status: 'confirmed' } })],
    [IDS.own, trip(IDS.own, { driver: me, pendingRequestsCount: 51 })],
    [IDS.emptyOwn, trip(IDS.emptyOwn, { driver: me, fromCity: 'Нижний Новгород', pendingRequestsCount: 0 })],
    [IDS.history, trip(IDS.history, { departureAt: PAST, date: '2026-10-23', status: 'completed' })],
  ]);
  const ownTrips = [trips.get(IDS.own), trips.get(IDS.emptyOwn), ...Array.from({ length: 19 }, (_, i) => trip(uuid(100 + i), { driver: me, fromCity: i === 18 ? 'СовпадениеНаВторойСтранице' : `Вологда ${i + 1}`, pendingRequestsCount: 0 }))];
  ownTrips.forEach(t => trips.set(t.id, t));
  const pending = Array.from({ length: 51 }, (_, i) => booking(uuid(200 + i), trips.get(IDS.own), user(uuid(300 + i), i === 50 ? 'Пассажир номер 51' : `Пассажир ${i + 1}`)));
  const secondTripBooking = booking(uuid(400), trips.get(IDS.emptyOwn), user(uuid(401), 'Пассажир другой поездки'));
  // Summary remains take 50 across trips: details MUST request per-trip pages.
  const state = { me: structuredClone(me), trips, ownTrips, pending, summary: [...pending.slice(0, 49), secondTripBooking], requests: [structuredClone(request)], reviews: [structuredClone(review)], reports: [structuredClone(report)], feedbacks: [structuredClone(feedback)], notifications: [structuredClone(notification)], unread: 101, blocks: [NAME, OTHER_NAME].map((name, i) => ({ user: user(uuid(500 + i), name), blockedAt: PAST })), failures: [], delays: [], empty: false, matchingEmpty: true };
  checked('authResponseSchema', { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 86400, user: state.me });
  for (const t of trips.values()) checked('tripSchema', t);
  pending.forEach(b => checked('bookingSchema', b));
  checked('rideRequestSchema', request);
  checked('reviewSchema', review);
  checked('reportSchema', report);
  checked('userFeedbackDtoSchema', feedback);
  checked('notificationSchema', notification);
  state.blocks.forEach(b => checked('blockedUserItemSchema', b));
  cities.forEach(c => checked('cityDtoSchema', c));
  return state;
}

// Explicit method/path dispatch: no catch-all empty 200 and no route.continue for APIs.
function respond(state, method, path, params, body) {
  const page = Number(params.get('page') || 1), limit = Number(params.get('limit') || 20);
  if (method === 'POST' && ['/auth/telegram', '/auth/refresh'].includes(path)) return checked('authResponseSchema', { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 86400, user: state.me });
  if (method === 'POST' && path === '/auth/ws-ticket') return { status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture WebSocket ticket intentionally unavailable' } };
  if (method === 'GET' && path === '/users/me') return checked('userSchema', state.me);
  if (method === 'PATCH' && ['/users/me', '/users/me/notification-settings'].includes(path)) {
    for (const [key, value] of Object.entries(body)) { if (value === null) delete state.me[key]; else state.me[key] = value; }
    return checked('userSchema', state.me);
  }
  if (method === 'POST' && path === '/users/me/onboarding') return checked('userSchema', state.me = { ...state.me, onboardingVersion: body.version });
  if (['POST', 'PATCH'].includes(method) && path === '/users/me/car') return checked('userSchema', state.me = { ...state.me, car: body });
  if (method === 'DELETE' && path === '/users/me/car') { delete state.me.car; return checked('userSchema', state.me); }
  if (method === 'DELETE' && path === '/users/me') return { success: true };
  if (method === 'GET' && /^\/users\/[^/]+$/.test(path)) { const id = path.split('/').at(-1); return checked('userSchema', id === IDS.me ? state.me : user(id, NAME)); }
  if (method === 'GET' && path === '/cities/suggest') return checked('citySuggestResponseSchema', { items: cities.filter(c => c.name.toLowerCase().includes((params.get('q') || '').toLowerCase())) });
  if (method === 'GET' && path === '/trips/my') {
    const q = (params.get('q') || '').toLowerCase();
    let items = params.get('status') === 'archive' ? [state.trips.get(IDS.history)] : state.ownTrips;
    items = state.empty ? [] : items.filter(t => `${t.fromCity} ${t.toCity}`.toLowerCase().includes(q));
    return checked('paginatedTripsResponseSchema', offset(items, page, limit));
  }
  if (method === 'GET' && path === '/trips') return checked('paginatedTripsResponseSchema', offset(state.empty || (params.has('fromCityId') && state.matchingEmpty) ? [] : [state.trips.get(IDS.free), state.trips.get(IDS.pending), state.trips.get(IDS.confirmed)], page, limit));
  if (method === 'POST' && path === '/trips') {
    checked('createTripDtoSchema', body);
    const t = trip(uuid(600), { ...body, driver: state.me, fromCity: cities.find(c => c.id === body.fromCityId).name, toCity: cities.find(c => c.id === body.toCityId).name });
    state.trips.set(t.id, t); return checked('tripSchema', t);
  }
  if (/^\/trips\/[^/]+(?:\/(cancel|complete))?$/.test(path)) {
    const id = path.split('/')[2], t = state.trips.get(id);
    if (!t) return { status: 404, error: { code: 'NOT_FOUND', message: 'Trip not found' } };
    if (method === 'GET') return checked('tripSchema', t);
    if (method === 'PATCH') { Object.assign(t, path.endsWith('/cancel') ? { status: 'cancelled' } : path.endsWith('/complete') ? { status: 'completed' } : checked('updateTripDtoSchema', body)); return checked('tripSchema', t); }
  }
  if (method === 'GET' && path === '/bookings/my') return (state.empty ? [] : [IDS.pending, IDS.confirmed].map((id, i) => ({ ...booking(uuid(50 + i), state.trips.get(id), me, i ? 'confirmed' : 'pending'), scope: 'active' }))).map(b => checked('passengerBookingSchema', b));
  if (method === 'GET' && path === '/bookings/history') return (state.empty ? [] : [{ ...booking(uuid(52), state.trips.get(IDS.history), me, 'confirmed'), scope: 'history', canReview: true, hasReview: false, historyCategory: 'completed' }]).map(b => checked('passengerBookingSchema', b));
  if (method === 'GET' && path === '/bookings/driver') return state.empty ? [] : state.summary;
  if (method === 'GET' && path.startsWith('/bookings/trip/')) return checked('paginatedBookingsResponseSchema', cursor(state.empty ? [] : path.endsWith(IDS.own) ? state.pending : [], params.get('cursor'), limit));
  if (method === 'POST' && path === '/bookings') {
    checked('createBookingDtoSchema', body);
    const t = state.trips.get(body.tripId), b = booking(uuid(601), t);
    b.seat = body.seat; b.comment = body.comment;
    t.myBooking = { id: b.id, seat: b.seat, status: 'pending' }; return checked('bookingSchema', b);
  }
  if (method === 'PATCH' && /^\/bookings\/[^/]+\/cancel$/.test(path)) { for (const t of state.trips.values()) if (t.myBooking?.id === path.split('/')[2]) t.myBooking = null; return { success: true }; }
  if (method === 'PATCH' && /^\/bookings\/[^/]+\/status$/.test(path)) { const b = state.pending.find(b => b.id === path.split('/')[2]); assert.ok(b, 'Known fixture booking'); b.status = body.status; return checked('bookingSchema', b); }
  if (method === 'GET' && path === '/ride-requests/feed') return { items: state.empty ? [] : [checked('rideRequestFeedItemSchema', { fromCity: cities[0], toCity: cities[1], people: 101, seats: 103, nextAt: FUTURE })] };
  if (method === 'GET' && path === '/ride-requests') return offset(state.empty ? [] : state.requests, page, limit);
  if (method === 'POST' && path === '/ride-requests') { checked('createRideRequestDtoSchema', body); const r = { ...request, ...body, id: uuid(602), fromCity: cities.find(c => c.id === body.fromCityId), toCity: cities.find(c => c.id === body.toCityId) }; state.requests.push(r); return checked('rideRequestSchema', r); }
  if (['PATCH', 'DELETE'].includes(method) && /^\/ride-requests\/[^/]+(?:\/status)?$/.test(path)) { const r = state.requests.find(r => r.id === path.split('/')[2]); assert.ok(r, 'Known fixture request'); Object.assign(r, method === 'DELETE' ? { status: 'cancelled' } : body); return checked('rideRequestSchema', r); }
  if (method === 'GET' && path === '/notifications/unread-count') return checked('unreadCountSchema', { unreadCount: state.unread });
  if (method === 'GET' && path === '/notifications/my') return checked('notificationsPageSchema', { items: state.empty ? [] : state.notifications.filter(n => !params.has('unreadOnly') || !n.isRead), nextCursor: null, unreadCount: state.unread });
  if (method === 'PATCH' && path === '/notifications/read-all') { state.notifications.forEach(n => n.isRead = true); state.unread = 0; return { success: true }; }
  if (method === 'PATCH' && /^\/notifications\/[^/]+\/read$/.test(path)) { const n = state.notifications.find(n => n.id === path.split('/')[2]); assert.ok(n); n.isRead = true; state.unread = 0; return checked('notificationSchema', n); }
  if (method === 'GET' && path === '/reviews/my') return state.empty ? [] : state.reviews;
  if (method === 'GET' && path === '/reviews/available-trips') return state.empty ? [] : [state.trips.get(IDS.history)];
  if (method === 'GET' && path.startsWith('/reviews/user/')) return checked('paginatedReviewsResponseSchema', cursor(state.empty ? [] : [review], params.get('cursor'), limit));
  if (method === 'POST' && path === '/reviews') { checked('createReviewDtoSchema', body); const r = { ...review, ...body, id: uuid(603), author: state.me, status: 'pending' }; state.reviews.push(r); return checked('reviewSchema', r); }
  if (method === 'GET' && path === '/feedback') return state.empty ? [] : state.feedbacks;
  if (method === 'POST' && ['/feedback', '/feedback/appeal'].includes(path)) { checked(path.endsWith('/appeal') ? 'feedbackTelegramAppealDtoSchema' : 'createFeedbackDtoSchema', body); state.feedbacks.push({ ...feedback, ...body, id: uuid(604), reply: null, repliedAt: null }); return checked('createFeedbackResponseSchema', { id: uuid(604), createdAt: PAST }); }
  if (method === 'GET' && path === '/reports') return state.empty ? [] : state.reports;
  if (method === 'GET' && path === '/reports/targets') return checked('reportTargetsSchema', [{ targetType: 'user', id: IDS.peer, name: NAME }, { targetType: 'trip', id: IDS.confirmed, fromCity: cities[0].name, toCity: cities[1].name, departureAt: FUTURE }]);
  if (method === 'POST' && path === '/reports') { checked('createReportDtoSchema', body); const r = { ...report, ...body, id: uuid(605), status: 'pending', resolutionNote: null, resolvedAt: null }; state.reports.push(r); return checked('reportSchema', r); }
  if (method === 'GET' && path === '/blocks') return checked('paginatedBlockedUsersSchema', offset(state.empty ? [] : state.blocks, page, limit));
  if (/^\/blocks\/[^/]+$/.test(path)) {
    const id = path.split('/').at(-1);
    if (method === 'GET') return checked('userBlockStatusSchema', { blockedByMe: state.blocks.some(b => b.user.id === id) });
    if (method === 'DELETE') { state.blocks = state.blocks.filter(b => b.user.id !== id); return { success: true }; }
    if (method === 'PUT') { assert.notEqual(id, IDS.me, 'Never allow fixture self-block'); const b = { user: user(id, NAME), blockedAt: PAST }; state.blocks.push(b); return checked('blockedUserItemSchema', b); }
  }
  return null;
}

const results = { full: process.env.E2E_UI_FULL === '1', filter: process.env.E2E_UI_FILTER || null, fixtureOnly: true, startedAt: new SystemDate().toISOString(), fixtureTime: NOW.toISOString(), matrix: [], cases: [], unknownApi: [], blockedExternal: [], pageErrors: [], rejections: [], fixtureErrors: [], requests: [], untested: [
  'Real Telegram iOS/Android keyboard, safe-area, native Back/swipe/popup, VoiceOver/TalkBack, landscape, 200% text scaling (task23 manual).',
  'Native share/clipboard/phone and real haptics: intentionally not invoked.',
  'Draft logout/same-user-login and all entity-switch permutations still require unit/privacy evidence; cross-owner refresh is exercised without patching the store.',
  'Background images, blur/gradients, custom Telegram palettes and disabled controls are outside computed contrast certification.',
  'Matrix pointer checks cover final controls, not exhaustive every-control overlap; 44px policy is gated only for driver/review profile targets and unblock.',
  'Overlay/swipe close variants, all loading/refetch/empty permutations on every route, and native accept/decline confirmations are not exhaustive; Profile/Notifications refetch failure is explicitly covered.',
  'Booking-comment success-after-unmount cleanup is not browser-gated: after booking the form correctly disappears; parent commit/privacy unit tests must cover that stored revision.',
  'U14 FAQ copy is checked in parent unit tests, not a browser text-copy gate here.',
] };
await mkdir(`${OUT}/screenshots`, { recursive: true });
let browser;

async function session(config = { width: 390, theme: 'light', platform: 'base' }) {
  const state = fixtures();
  const context = await browser.newContext({ viewport: { width: config.width, height: ({ 320: 568, 390: 844, 430: 932 })[config.width] }, reducedMotion: 'reduce', colorScheme: config.theme, serviceWorkers: 'block', locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const errors = [], unknown = [], requests = [], held = [];
  await context.addInitScript(({ theme, platform }) => {
    localStorage.setItem('edem:theme-override', theme);
    localStorage.setItem('edem:dev-platform', platform === 'ios' ? 'ios' : 'android');
    localStorage.setItem('edem:sound-enabled', '0');
    Math.random = () => 0.5;
    window.__uiRejections = [];
    addEventListener('unhandledrejection', event => window.__uiRejections.push(String(event.reason)));
  }, config);
  await context.routeWebSocket('**', ws => {
    const url = new URL(ws.url());
    const viteHmr = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === new URL(BASE).port && url.pathname === '/' && url.searchParams.has('token');
    if (url.pathname === '/api/v1/ws' || viteHmr) {
      // Current client uses raw WS, newer deployments may use the 503 ticket stub.
      // Both transports are isolated: never call connectToServer for backend or HMR.
      results.requests.push({ method: 'WS', path: url.pathname, status: 'mock-close-1000' });
      ws.close({ code: 1000, reason: 'Isolated browser fixture' });
    } else { unknown.push({ method: 'WS', url: ws.url() }); results.unknownApi.push({ method: 'WS', url: ws.url() }); ws.close(); }
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/__ui-remediation-avatar.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#64748b"/></svg>' });
    // Critical: /src/api/*.ts are Vite JS MODULES, not JSON endpoints.
    if (!/^\/api\/v1(?:\/|$)/.test(url.pathname)) {
      if (url.origin === new URL(BASE).origin || !/^https?:$/.test(url.protocol)) return route.continue();
      results.blockedExternal.push({ method: req.method(), url: req.url() });
      return route.abort('blockedbyclient');
    }
    const path = url.pathname.slice('/api/v1'.length), method = req.method();
    let body;
    try { body = req.postData() ? req.postDataJSON() : {}; } catch { body = {}; }
    const entry = { method, path, query: url.search, body, status: null };
    requests.push(entry); results.requests.push(entry);
    const failure = state.failures.find(f => f.method === method && f.path === path && (!f.query || f.query(url.searchParams)));
    if (failure) {
      if (failure.once) state.failures.splice(state.failures.indexOf(failure), 1);
      entry.status = failure.status;
      return route.fulfill({ status: failure.status, json: { code: failure.code || 'FIXTURE_ERROR', message: failure.message || 'Синтетическая ошибка сервиса', retryAfterMs: 1000 } });
    }
    const delay = state.delays.find(d => d.method === method && d.path === path);
    if (delay) { if (!delay.all) state.delays.splice(state.delays.indexOf(delay), 1); await new Promise(resolve => { held.push({ entry, resolve }); delay.entered?.(); }); }
    try {
      const response = respond(state, method, path, url.searchParams, body);
      if (response === null) { entry.status = 501; unknown.push(entry); results.unknownApi.push(entry); return route.fulfill({ status: 501, json: { code: 'UNSTUBBED_API', message: `Unstubbed ${method} ${path}` } }); }
      entry.status = response.error ? response.status : 200;
      return route.fulfill({ status: entry.status, json: response.error || response });
    } catch (error) {
      entry.status = 500; results.fixtureErrors.push({ ...entry, error: error.message });
      return route.fulfill({ status: 500, json: { code: 'INVALID_FIXTURE', message: error.message } });
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async native => { errors.push(`Unexpected native ${native.type()}: ${native.message()}`); await native.dismiss(); });
  if (config.clock) await page.clock.install({ time: NOW });
  else await page.clock.setFixedTime(NOW);
  return { state, context, page, requests, held, unknown,
    async close() {
      held.forEach(h => h.resolve());
      const rejections = await page.evaluate(() => window.__uiRejections || []).catch(() => []);
      results.pageErrors.push(...errors); results.rejections.push(...rejections);
      await context.close();
      assert.equal(errors.length, 0, `Browser exceptions: ${errors.join('; ')}`);
      assert.equal(rejections.length, 0, `Unhandled rejection: ${rejections.join('; ')}`);
      assert.equal(unknown.length, 0, `Unstubbed API/WS: ${JSON.stringify(unknown)}`);
    },
  };
}

const text = (page, value) => page.getByText(value, { exact: true });
const dialog = (page, name) => page.getByRole('dialog', { name: name === 'Поездка' ? 'Детали поездки' : name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name: name === 'Автомобиль' ? /^Автомобиль\./ : name === 'Ищу попутку' ? 'Ищу попутку. Нужна попутка?' : name, exact: typeof name === 'string' && name !== 'Автомобиль' });
async function visible(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate(async el => {
    const surface = el.closest('[role="dialog"]') || el;
    const finite = surface.getAnimations({ subtree: true }).filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map(a => a.finished.catch(() => {}))); // Cancellation is normal during React replacement.
  });
}
async function disabled(locator) {
  await locator.and(locator.page().locator(':disabled')).waitFor({ state: 'visible' });
  assert.ok(await locator.isDisabled(), 'Pending/terminal control is disabled');
}
async function valueIs(locator, expected) { await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.value === expected, { selector: await locator.evaluate(el => `#${CSS.escape(el.id)}`), expected }); assert.equal(await locator.inputValue(), expected); }
async function nav(page, path, expected, cold = false) {
  if (cold || page.url() === 'about:blank') await page.goto(`${BASE}/#${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  else await page.evaluate(path => { location.hash = path; }, path);
  // Hash/networkidle alone can still show the previous React page.
  await visible(expected(page));
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
async function closeSheet(page, name) {
  const target = dialog(page, name);
  const id = await target.getAttribute('id');
  assert.ok(id, 'Track the exact dialog through exit animation');
  await page.keyboard.press('Escape');
  await page.locator(`[id="${id}"]`).waitFor({ state: 'detached' });
}
async function shot(page, name) { const path = `${OUT}/screenshots/${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`; await page.screenshot({ path }); return path; }
async function runCase(name, objective, fn, config) {
  if (FILTER && !FILTER.test(name)) return;
  const record = { name, objective, status: 'running' };
  results.cases.push(record);
  let s;
  try { s = await session(config); await fn(s, record); await s.close(); s = null; record.status = 'passed'; }
  catch (error) { record.status = 'failed'; record.error = error.stack || error.message; if (s) { record.dom = await s.page.locator('body').innerText().catch(() => ''); record.requests = s.requests; record.screenshot = await shot(s.page, name).catch(e => `Screenshot failed: ${e.message}`); await s.close().catch(e => { record.cleanupError = e.message; }); } }
  console.info(`${record.status.toUpperCase()} ${name}`);
}

// Arrange the 17 audited routes, each with content AND a usable-control expectation.
const ROUTES = [
  ['home', '/', p => button(p, 'Ищу попутку')],
  ['search', '/trips', p => button(p, 'Найти')],
  ['bookings', '/bookings', p => p.locator('#bookings-search')],
  ['notifications', '/notifications', p => text(p, 'Бронь подтверждена')],
  ['profile', '/profile', p => button(p, 'Редактировать профиль')],
  ['history', '/profile/history', p => p.getByText(/Оставьте отзыв/)],
  ['request-history', '/profile/ride-requests', p => p.getByTestId(`ride-request-cell-${IDS.request}`)],
  ['reviews', '/reviews', p => text(p, review.text)],
  ['support', '/profile/support', p => button(p, 'Создать обращение')],
  ['reports', '/profile/reports', p => button(p, 'Подать жалобу')],
  ['blocked', '/profile/blocked-users', p => button(p, `Разблокировать ${NAME}`)],
  ['create', '/trips/my/new', p => p.locator('#create-comment')],
  ['edit-profile', '/profile/edit', p => dialog(p, 'Редактировать профиль').locator('#profile-name')],
  ['vehicle', '/vehicle', p => dialog(p, 'Автомобиль').locator('#vehicle-model')],
  ['settings', '/settings', p => button(dialog(p, 'Настройки уведомлений'), 'Выключить некритичные')],
  ['details', `/trips/${IDS.free}`, p => dialog(p, 'Поездка').getByRole('button', { name: /Забронировать место/ })],
  ['driver-requests', `/trips/my/${IDS.own}/requests`, p => dialog(p, 'Заявки пассажиров').getByText('Пассажир 1', { exact: true })],
];

// Page/sheet active-surface geometry; do not count the inert background behind a dialog.
async function geometry(page, fraction) {
  return page.evaluate(async ({ fraction, iosClass }) => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(el => el.getAttribute('data-state') !== 'closed');
    const surface = dialogs.at(-1) || document.querySelector('main');
    if (!surface) throw new Error('Missing active main/dialog surface');
    const scrollables = [...surface.querySelectorAll('*'), surface].filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1);
    // A page scrolls through the document; a scrollable form control (the comment textarea)
    // must never hijack the probe and leave the rest of the page unreachable. Dialog sheets
    // keep their own internal scroller.
    const docScroller = document.scrollingElement;
    const docScrollable = !dialogs.length && docScroller && docScroller.scrollHeight > docScroller.clientHeight + 1;
    const scroll = docScrollable ? docScroller : scrollables.filter(el => el.tagName !== 'TEXTAREA').sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || docScroller || document.scrollingElement;
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * fraction;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visible = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.clip === 'auto' && !el.closest('[hidden],[aria-hidden="true"]') && r.bottom > 0 && r.top < innerHeight; };
    const controls = [...surface.querySelectorAll('button,input,select,textarea,a[href],[role="button"],[role="switch"],[role="radio"],[role="tab"]')].filter(el => !el.closest('[hidden],[aria-hidden="true"]') && !el.matches(':disabled') && el.getBoundingClientRect().width > 0);
    const hits = controls.filter(visible).map(el => {
      const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2)), y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2)), hit = document.elementFromPoint(x, y);
      const own = !!hit && (el === hit || el.contains(hit));
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || el.id, hit: own, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, ...(own ? {} : { occluder: hit ? { tag: hit.tagName, id: hit.id, class: typeof hit.className === 'string' ? hit.className : '', text: hit.textContent?.trim().slice(0, 80) } : null }) };
    });
    const overflow = [...surface.querySelectorAll('*')].filter(visible).filter(el => {
      const r = el.getBoundingClientRect();
      let left = r.left, right = r.right;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left); right = Math.min(right, clip.right);
        }
      }
      return right > left && (left < -1 || right > innerWidth + 1);
    }).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 80), class: el.className }));
    const theme = document.querySelector('.app-theme'), tokens = ['--app-action-surface', '--app-muted', '--app-page-pad-bottom', '--app-sheet-pad-bottom'].map(key => [key, theme ? getComputedStyle(theme).getPropertyValue(key).trim() : '']);
    const last = controls.at(-1);
    const lastHit = last ? (() => { const r = last.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === last || last.contains(hit)); })() : false;
    return { fraction, platform: theme?.classList.contains(iosClass) ? 'ios' : 'base', scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop, scrollTarget: { tag: scroll.tagName, class: typeof scroll.className === 'string' ? scroll.className : '', clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight }, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, overflow, hits, controlCount: controls.length, lastControl: last ? { name: last.textContent?.trim() || last.id, visible: visible(last), hit: lastHit, rect: last.getBoundingClientRect().toJSON() } : null, tokens, dark: document.documentElement.classList.contains('dark'), cssRules: [...document.styleSheets].reduce((n, sheet) => { try { return n + sheet.cssRules.length; } catch { return n; } }, 0) };
  }, { fraction, iosClass: IOS_ROOT_CLASS });
}

async function contrast(page, selector = null) {
  return page.evaluate(selector => {
    const color = raw => {
      const n = raw.match(/[\d.]+/g)?.map(Number);
      if (!n || n.length < 3 || (raw.startsWith('color(') && !raw.startsWith('color(srgb '))) throw new Error(`Unsupported computed color ${raw}`);
      return { rgb: raw.startsWith('color(') ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3), a: n[3] ?? 1 };
    };
    const over = (top, bottom) => top.rgb.map((v, i) => v * top.a + bottom[i] * (1 - top.a));
    const backdrop = el => { const layers = []; let opaque = false; for (let n = el; n; n = n.parentElement) { const c = color(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a === 1) { opaque = true; break; } } let rgb = [255, 255, 255]; for (const c of layers.reverse()) rgb = over(c, rgb); return { rgb, opaque }; };
    const lum = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0);
    const samples = [];
    const root = selector ? document.querySelector(selector) : [...document.querySelectorAll('[role="dialog"]')].at(-1) || document.querySelector('main');
    if (!root) throw new Error('Missing contrast surface');
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (cs.clip !== 'auto' || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || el.closest('[hidden],button:disabled') || (el.closest('[aria-hidden="true"]') && !el.closest('[class*="badge"]')) || cs.visibility === 'hidden') continue;
      const own = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
      // Avatar initials/decorative text are not interface contrast carriers.
      if (el.closest('[class*="Avatar"],[class*="avatar"]')) continue;
      const placeholder = ['INPUT', 'TEXTAREA'].includes(el.tagName) && el.placeholder && !el.value;
      if (!own && !placeholder) continue;
      const style = placeholder ? getComputedStyle(el, '::placeholder') : cs;
      const bg = backdrop(el), fg = over(color(style.color), bg.rgb);
      let opacity = 1; for (let n = el; n && n !== root.parentElement; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      const painted = fg.map((v, i) => v * opacity + bg.rgb[i] * (1 - opacity));
      const ratio = (Math.max(lum(painted), lum(bg.rgb)) + .05) / (Math.min(lum(painted), lum(bg.rgb)) + .05);
      const min = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 600) ? 3 : 4.5;
      samples.push({ text: placeholder ? el.placeholder : own, kind: placeholder ? 'placeholder' : el.closest('[class*="badge"]') ? 'badge' : el.closest('button') ? 'button' : 'text', color: style.color, bg: bg.rgb, opaque: bg.opaque, ratio, min });
    }
    return samples;
  }, selector);
}

async function matrix() {
  const configs = results.full ? [320, 390, 430].flatMap(width => ['light', 'dark'].flatMap(theme => ['ios', 'base'].map(platform => ({ width, theme, platform })))) : [{ width: 320, theme: 'light', platform: 'ios' }, { width: 390, theme: 'dark', platform: 'base' }, { width: 430, theme: 'light', platform: 'base' }];
  results.matrixExpected = configs.length * ROUTES.length;
  for (const config of configs) for (const [name, path, expected] of ROUTES) {
    if (FILTER && !FILTER.test(`matrix-${name}`)) continue;
    // Arrange: isolated authenticated API fixture and exact route DOM readiness.
    const record = { ...config, route: path, name, status: 'running', positions: [] }; results.matrix.push(record);
    let s;
    try {
      s = await session(config); await nav(s.page, path, expected, true);
      // Act: measure top, middle, bottom of the actual page/sheet scrolling surface.
      const violations = [];
      for (const [position, fraction] of [['top', 0], ['middle', .5], ['bottom', 1]]) {
        const layout = await geometry(s.page, fraction), samples = await contrast(s.page);
        record.positions.push({ position, layout, contrast: samples, screenshot: await shot(s.page, `${name}-${config.width}-${config.theme}-${config.platform}-${position}`) });
        // Assert: loaded styles and real controls, never black-on-white unstyled green.
        try {
          assert.ok(layout.cssRules > 10 && layout.tokens.every(([_key, value]) => value), 'Styles/action/layout tokens are missing');
          assert.equal(layout.dark, config.theme === 'dark', 'Requested theme actually applied');
          assert.equal(layout.platform, config.platform, 'Requested platform actually applied');
          assert.ok(layout.controlCount > 0, 'Expected interactive surface is not empty');
          assert.equal(layout.documentOverflow, false, 'Document has horizontal overflow');
          assert.equal(layout.overflow.length, 0, `Visible surface overflow: ${JSON.stringify(layout.overflow)}`);
          assert.ok(samples.length > 0 && samples.some(s => s.opaque), 'No composed opaque contrast samples');
          assert.deepEqual(samples.filter(s => s.ratio + .01 < s.min), [], 'Computed interface contrast below WCAG threshold');
          if (position === 'bottom') assert.ok(layout.lastControl?.visible && layout.lastControl.hit, `Last control unreachable/occluded: ${JSON.stringify(layout.lastControl)}`);
        } catch (error) { violations.push({ position, error: error.message }); }
      }
      record.violations = violations;
      assert.equal(violations.length, 0, JSON.stringify(violations));
      await s.close(); s = null; record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = error.stack || error.message; if (s) { record.failureScreenshot = await shot(s.page, `${name}-${config.width}-${config.theme}-${config.platform}-failed`).catch(e => e.message); await s.close().catch(e => record.cleanupError = e.message); } }
    console.info(`${record.status.toUpperCase()} matrix ${name} ${config.width} ${config.theme} ${config.platform}`);
  }
}

// Effective 44x44 target: pointer hit-testing includes ::before/::after expansion.
async function hit44(locator) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const points = [-21.9, 0, 21.9].flatMap(dx => [-21.9, 0, 21.9].map(dy => { const x = cx + dx, y = cy + dy, hit = document.elementFromPoint(x, y); return { x, y, hit: !!hit && (el === hit || el.contains(hit)) }; }));
    return { width: r.width, height: r.height, points };
  });
  assert.ok(result.points.every(p => p.hit), `44px effective hit area failed: ${JSON.stringify(result)}`);
  return result;
}

// Круглая icon-кнопка 44×44: углы квадрата лежат вне её формы, поэтому
// проверяем центр и восемь направлений по вписанной окружности.
async function hit44Round(locator) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2, radius = Math.min(r.width, r.height) / 2 - .1;
    const points = [{ x: cx, y: cy, hit: (() => { const hit = document.elementFromPoint(cx, cy); return !!hit && (el === hit || el.contains(hit)); })() }];
    for (let i = 0; i < 8; i += 1) { const angle = (Math.PI / 4) * i, x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius, hit = document.elementFromPoint(x, y); points.push({ x, y, hit: !!hit && (el === hit || el.contains(hit)) }); }
    return { width: r.width, height: r.height, points };
  });
  assert.ok(result.width >= 44 && result.height >= 44, `Icon target is smaller than 44px: ${JSON.stringify(result)}`);
  assert.ok(result.points.every(p => p.hit), `44px round hit area failed: ${JSON.stringify(result)}`);
  return result;
}

function waitRequest(s, method, path) {
  const promise = s.page.waitForRequest(req => req.method() === method && new URL(req.url()).pathname === `/api/v1${path}`);
  promise.catch(() => {}); // Still rejected to the caller, but safe if its UI action fails first.
  return promise;
}
function defer(s, method, path, all = false) {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  s.state.delays.push({ method, path, entered, all });
  return ready;
}
async function heldSubmission(s, method, path, submit) {
  const ready = defer(s, method, path);
  const sent = waitRequest(s, method, path);
  await submit(); await Promise.all([ready, sent]);
  assert.ok(s.held.some(h => h.entry.method === method && h.entry.path === path), 'Mock mutation must be genuinely deferred');
}
async function release(s, method, path) {
  const held = s.held.filter(h => h.entry.method === method && h.entry.path === path);
  assert.ok(held.length, 'Deferred request exists');
  s.state.delays = s.state.delays.filter(d => d.method !== method || d.path !== path);
  const response = s.page.waitForResponse(res => res.request().method() === method && new URL(res.url()).pathname === `/api/v1${path}`);
  held.forEach(h => h.resolve()); await (await response).finished();
}

// All draft tests use ordinary UI/navigation and real detach/reopen, never reload/store imports.
function draftDescriptors() {
  return [
    { name: 'profile', route: '/profile', ready: p => button(p, 'Редактировать профиль'), open: async p => { await button(p, 'Редактировать профиль').click(); await visible(p.locator('#profile-name')); }, field: '#profile-name', draft: ' Черновик профиля ', newer: 'Новый черновик профиля', method: 'PATCH', path: '/users/me', submit: 'Сохранить изменения', sheet: 'Редактировать профиль', cleared: 'Черновик профиля', cancel: 'Отмена' },
    { name: 'vehicle', route: '/profile', ready: p => button(p, 'Автомобиль'), open: async p => { await button(p, 'Автомобиль').click(); await visible(p.locator('#vehicle-model')); }, field: '#vehicle-model', draft: ' Черновик автомобиля ', newer: 'Новая модель', method: 'POST', path: '/users/me/car', submit: 'Сохранить автомобиль', sheet: 'Автомобиль', cleared: 'Черновик автомобиля', cancel: 'Отмена' },
    { name: 'support', route: '/profile/support', ready: p => button(p, 'Создать обращение'), open: async p => { await button(p, 'Создать обращение').click(); await visible(p.locator('#support-text')); await p.locator('#support-subject').fill('Тестовое обращение'); }, field: '#support-text', draft: 'Черновик обращения', newer: 'Новое сообщение', method: 'POST', path: '/feedback', submit: 'Отправить', sheet: 'Создать обращение', cleared: '' },
    { name: 'report', route: '/profile/reports', ready: p => button(p, 'Подать жалобу'), open: async p => { await button(p, 'Подать жалобу').click(); await visible(p.locator('#report-description')); }, prepare: async p => p.locator('#report-target').selectOption(`user:${IDS.peer}`), field: '#report-description', draft: 'Черновик жалобы', newer: 'Новое описание жалобы', method: 'POST', path: '/reports', submit: 'Отправить жалобу', sheet: 'Подать жалобу', cleared: '' },
    { name: 'ride-create', route: '/', ready: p => button(p, 'Ищу попутку'), open: async p => { await button(p, 'Ищу попутку').click(); await visible(p.locator('#ride-earliest')); }, prepare: async p => { await p.locator('#ride-from').selectOption(cities[0].id); await p.locator('#ride-to').selectOption(cities[1].id); await p.locator('#ride-latest').fill('2026-11-08T21:00'); }, field: '#ride-earliest', draft: '2026-11-06T12:00', newer: '2026-11-07T12:00', method: 'POST', path: '/ride-requests', submit: 'Опубликовать запрос', sheet: 'Ищу попутку', cleared: '', cancel: 'Отмена' },
    { name: 'ride-edit', route: '/profile/ride-requests', ready: p => p.getByTestId(`ride-request-cell-${IDS.request}`), open: async p => { await p.getByTestId(`ride-request-cell-${IDS.request}`).click(); await button(dialog(p, 'Запрос на попутку'), 'Редактировать').click(); await visible(p.locator(`#ride-edit-seats-${IDS.request}`)); }, field: `#ride-edit-seats-${IDS.request}`, draft: '02', newer: '1', method: 'PATCH', path: `/ride-requests/${IDS.request}`, submit: 'Сохранить', sheet: 'Запрос на попутку', cleared: '2', cancel: 'Отмена' },
    { name: 'trip-edit', route: `/trips/${IDS.own}`, ready: p => button(dialog(p, 'Поездка'), 'Редактировать поездку'), open: async p => { if (!(await p.locator('#edit-comment').count())) await button(dialog(p, 'Поездка'), 'Редактировать поездку').click(); await visible(p.locator('#edit-comment')); }, field: '#edit-comment', draft: ' Черновик условий ', newer: 'Новый комментарий водителя', method: 'PATCH', path: `/trips/${IDS.own}`, submit: 'Сохранить', sheet: 'Поездка', cleared: 'Черновик условий', cancel: 'Отмена', reopenRoute: true },
    { name: 'trip-create', route: '/trips/my/new', ready: p => p.locator('#create-comment'), open: async p => visible(p.locator('#create-comment')), prepare: async p => { await p.locator('#create-from').selectOption(cities[0].id); await p.locator('#create-to').selectOption(cities[1].id); for (const [id, value] of [['create-date', '2026-11-06T12:00'], ['create-price', '100000'], ['create-distance', '180'], ['create-duration', '2']]) await p.locator(`#${id}`).fill(value); }, field: '#create-comment', draft: 'Черновик новой поездки', newer: 'Новый текст поездки', method: 'POST', path: '/trips', submit: 'Опубликовать', cleared: '', cancel: 'Отмена' },
    { name: 'review', route: '/reviews', ready: p => p.getByRole('tab', { name: 'Новая', exact: true }), open: async p => { await p.getByRole('tab', { name: 'Новая', exact: true }).click(); await visible(p.locator('#review-text')); }, field: '#review-text', draft: 'Черновик отзыва', newer: 'Новый текст отзыва', method: 'POST', path: '/reviews', submit: 'Отправить отзыв', cleared: '' },
  ];
}
async function leaveDraft(s, d) {
  if (d.sheet) await closeSheet(s.page, d.sheet);
  if (!d.sheet || d.reopenRoute) await nav(s.page, '/profile/support', p => button(p, 'Создать обращение'));
  await s.page.locator(d.field).waitFor({ state: 'detached' });
}
async function reopenDraft(s, d) { if (!d.sheet || d.reopenRoute) await nav(s.page, d.route, d.ready); await d.open(s.page); }
async function drafts() {
  for (const d of draftDescriptors()) {
    await runCase(`draft-${d.name}-close-reopen`, 'U05: accidental close retains; explicit cancel clears where offered; no persistent PII', async s => {
      // Arrange
      await nav(s.page, d.route, d.ready); await d.open(s.page); await d.prepare?.(s.page); await s.page.locator(d.field).fill(d.draft);
      // Act
      await leaveDraft(s, d); await reopenDraft(s, d);
      // Assert
      await valueIs(s.page.locator(d.field), d.draft);
      if (d.name === 'ride-create') {
        const publish = button(dialog(s.page, d.sheet), d.submit);
        await publish.scrollIntoViewIfNeeded();
        const surface = await publish.evaluate(el => getComputedStyle(el).backgroundColor);
        assert.ok(surface !== 'transparent' && surface !== 'rgba(0, 0, 0, 0)', 'U22 publication is visibly primary, not a transparent secondary action');
        const samples = (await contrast(s.page)).filter(sample => sample.text === d.submit);
        assert.ok(samples.length > 0 && samples.every(sample => sample.ratio >= sample.min), 'Publication contrast has real samples');
      }
      const stored = await s.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
      if (d.draft.length > 8) assert.ok(stored.every(value => !value.includes(d.draft)), 'Draft text must not enter localStorage/sessionStorage');
      if (d.cancel) {
        await button(d.sheet ? dialog(s.page, d.sheet) : s.page.locator('main'), d.cancel).click();
        // Some explicit cancels reset inline editing but leave the parent sheet open.
        if (d.sheet && await dialog(s.page, d.sheet).count()) await closeSheet(s.page, d.sheet);
        if (d.reopenRoute || !d.sheet) await nav(s.page, '/profile/support', p => button(p, 'Создать обращение'));
        await s.page.locator(d.field).waitFor({ state: 'detached' });
        await reopenDraft(s, d);
        assert.notEqual(await s.page.locator(d.field).inputValue(), d.draft, 'Explicit cancel must clear revision');
      }
    });
    for (const newer of [false, true]) await runCase(`draft-${d.name}-deferred-${newer ? 'newer-retained' : 'success-cleans'}`, 'U05: success after genuine unmount clears only submitted revision', async s => {
      // Arrange
      await nav(s.page, d.route, d.ready); await d.open(s.page); await d.prepare?.(s.page); await s.page.locator(d.field).fill(d.draft);
      // Act
      await heldSubmission(s, d.method, d.path, () => button(d.sheet ? dialog(s.page, d.sheet) : s.page.locator('main'), d.submit).click());
      await disabled(button(d.sheet ? dialog(s.page, d.sheet) : s.page.locator('main'), d.submit));
      await leaveDraft(s, d);
      if (newer) { await reopenDraft(s, d); await s.page.locator(d.field).fill(d.newer); }
      const activeRead = { support: '/feedback', report: '/reports', 'ride-create': '/ride-requests/feed', 'ride-edit': '/ride-requests', ...(newer ? { review: '/reviews/my' } : {}) }[d.name];
      const refreshed = activeRead ? s.page.waitForResponse(res => res.request().method() === 'GET' && new URL(res.url()).pathname === `/api/v1${activeRead}`) : null;
      refreshed?.catch(() => {});
      await release(s, d.method, d.path);
      // Assert: wait on a fresh read/query render, not merely on the fulfilled POST.
      if (refreshed) await (await refreshed).finished();
      if (d.name === 'profile') await visible(text(s.page, d.cleared));
      if (d.name === 'vehicle') await visible(s.page.locator('main [aria-label^="Автомобиль."]').filter({ hasText: d.cleared }));
      await s.page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      if (!newer) await reopenDraft(s, d);
      await valueIs(s.page.locator(d.field), newer ? d.newer : d.cleared);
      assert.equal(s.requests.filter(r => r.method === d.method && r.path === d.path).length, 1, 'Exactly one mutation');
    });
  }
}

async function regressions() {
  await runCase('booking-comment-draft-error-success', 'U05: booking comment survives actual close/unmount/reopen; failed booking retains it; success becomes pending', async s => {
    // Arrange
    await nav(s.page, `/trips/${IDS.free}`, p => button(dialog(p, 'Поездка'), 'Добавить комментарий водителю'));
    await button(dialog(s.page, 'Поездка'), 'Добавить комментарий водителю').click();
    await s.page.locator('#booking-comment').fill('Синтетический черновик бронирования');
    // Act
    await closeSheet(s.page, 'Поездка'); await s.page.locator('#booking-comment').waitFor({ state: 'detached' });
    await nav(s.page, `/trips/${IDS.free}`, p => p.locator('#booking-comment'));
    // Assert
    await valueIs(s.page.locator('#booking-comment'), 'Синтетический черновик бронирования');
    s.state.failures.push({ method: 'POST', path: '/bookings', status: 409, code: 'SEAT_TAKEN', once: true });
    await button(dialog(s.page, 'Поездка'), /Забронировать место/).click();
    await visible(dialog(s.page, 'Поездка').getByText('Место только что заняли — выберите другое', { exact: true }));
    await valueIs(s.page.locator('#booking-comment'), 'Синтетический черновик бронирования');
    await button(dialog(s.page, 'Поездка'), /Забронировать место/).click();
    await visible(dialog(s.page, 'Поездка').getByText('Заявка отправлена', { exact: true }));
    assert.deepEqual(s.requests.filter(r => r.method === 'POST' && r.path === '/bookings').map(r => r.status), [409, 200]);
  });
  await runCase('my-trips-hasmore-error-explicit-retry', 'U08: 21st trip accessible through hasMore; next-page error retains first page and does not loop', async s => {
    // Arrange
    s.state.failures.push({ method: 'GET', path: '/trips/my', query: p => p.get('page') === '2', status: 409, once: true });
    await nav(s.page, '/bookings?segment=driver', p => p.locator('#bookings-search'));
    await visible(s.page.getByText('Нижний Новгород', { exact: true }));
    // Act: activate the actual fallback handler without scrolling the auto-sentinel into view first.
    const end = s.page.getByRole('button', { name: /^(Показать ещё|Повторить загрузку)$/ });
    await visible(end);
    if (await button(s.page, 'Показать ещё').count()) await button(s.page, 'Показать ещё').evaluate(el => el.click());
    await visible(s.page.getByRole('alert').filter({ hasText: 'Не удалось загрузить ещё' }));
    // Assert
    assert.equal(s.requests.filter(r => r.path === '/trips/my' && new URLSearchParams(r.query).get('page') === '2').length, 1);
    await visible(s.page.getByText('Нижний Новгород', { exact: true }));
    await button(s.page, 'Повторить загрузку').click();
    await visible(s.page.getByText('СовпадениеНаВторойСтранице', { exact: true }));
    assert.equal(await button(s.page, 'Показать ещё').count(), 0);
  });
  await runCase('max-route-request-name-320', 'U10/U11 plus request identity: 100-character routes/names and 500-character comment are not vacuous fixtures', async (s, record) => {
    // Arrange
    const from = ('Вологда — синтетический длинный маршрут ').repeat(3).slice(0, 100);
    const to = ('Череповец — синтетический длинный маршрут ').repeat(3).slice(0, 100);
    Object.assign(s.state.trips.get(IDS.history), { fromCity: from, toCity: to });
    s.state.pending[0].passenger = user(uuid(800), NAME);
    // Act
    await nav(s.page, '/profile/history', p => p.getByText(/Оставьте отзыв/));
    const route = s.page.getByRole('button', { name: /^Поездка .*Оставьте отзыв/ }).getByText(`${from} → ${to}`, { exact: true });
    await route.scrollIntoViewIfNeeded();
    record.route = await route.evaluate(el => ({ text: el.textContent, scrollWidth: el.parentElement.scrollWidth, width: el.parentElement.clientWidth }));
    // Assert
    assert.ok(record.route.text.length > 200 && record.route.scrollWidth <= record.route.width + 1);
    await nav(s.page, `/trips/${IDS.own}`, p => button(dialog(p, 'Поездка'), `Открыть профиль: ${NAME}`));
    const name = button(dialog(s.page, 'Поездка'), `Открыть профиль: ${NAME}`);
    await name.scrollIntoViewIfNeeded();
    record.name = await name.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, text: el.textContent }));
    assert.equal(record.name.text.trim().length, 100); assert.ok(record.name.width > 100 && record.name.scrollWidth <= record.name.width + 1);
    assert.equal((await geometry(s.page, .5)).overflow.length, 0);
    record.screenshot = await shot(s.page, 'max-route-request-name-320');
  }, { width: 320, theme: 'light', platform: 'ios' });
  await runCase('events-tab-99plus-and-markall-error-success', 'U13/U20: readable short tab/full accessible count, computed 99+ badge contrast; mark-all failure then success', async (s, record) => {
    // Arrange
    await nav(s.page, '/notifications', p => text(p, 'Бронь подтверждена'));
    const events = s.page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'События — уведомления, непрочитанных: 101', exact: true });
    await visible(events); await visible(events.getByText('События', { exact: true }));
    // Act
    record.badges = (await contrast(s.page, 'nav[aria-label="Основные разделы"]')).filter(sample => sample.kind === 'badge' && sample.text === '99+');
    // Assert
    assert.ok(record.badges.length > 0 && record.badges.every(sample => sample.opaque && sample.ratio >= 4.5), '99+ badge requires actual composed contrast');
    s.state.failures.push({ method: 'PATCH', path: '/notifications/read-all', status: 429, once: true });
    await button(s.page, 'Прочитать все (101)').click(); await visible(s.page.getByRole('alert').first());
    await visible(text(s.page, 'Бронь подтверждена'));
    await button(s.page, 'Прочитать все (101)').click(); await visible(button(s.page, 'Все уведомления прочитаны'));
    assert.ok(await button(s.page, 'Все уведомления прочитаны').isDisabled());
    assert.deepEqual(s.requests.filter(r => r.path === '/notifications/read-all').map(r => r.status), [429, 200]);
  }, { width: 320, theme: 'dark', platform: 'base' });
  for (const seats of [1, 2, 3]) await runCase(`booking-static-${seats}-seats`, 'Booking bar final normal flow; no seats means no submit', async (s, record) => {
    // Arrange
    Object.assign(s.state.trips.get(IDS.free), { seatsTotal: seats, seatsAvailable: seats });
    await nav(s.page, `/trips/${IDS.free}`, p => dialog(p, 'Поездка').getByRole('button', { name: /Забронировать место/ }));
    const root = dialog(s.page, 'Поездка');
    // Act
    record.layout = await root.evaluate(el => { const submit = [...el.querySelectorAll('button')].find(b => b.textContent.includes('Забронировать место')), bar = submit.parentElement, conditions = [...el.querySelectorAll('span')].find(n => n.textContent === 'Комментарий водителя')?.parentElement; if (!conditions) throw new Error('Missing driver-comment block'); const positioned = []; for (let n = bar; n && n !== el; n = n.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(n).position)) positioned.push(n.className); return { positioned, afterConditions: !!(conditions.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING), lastButton: [...el.querySelectorAll('button')].at(-1) === submit, surface: getComputedStyle(submit).backgroundColor }; });
    // Assert
    assert.deepEqual(record.layout.positioned, []); assert.ok(record.layout.afterConditions && record.layout.lastButton);
    assert.notEqual(record.layout.surface, 'rgba(0, 0, 0, 0)', 'Primary submit must have applied surface');
    await closeSheet(s.page, 'Поездка');
    s.state.trips.get(IDS.free).seatsAvailable = 0;
    await nav(s.page, `/trips/${IDS.emptyOwn}`, p => button(dialog(p, 'Поездка'), 'Редактировать поездку'));
    await closeSheet(s.page, 'Поездка');
    // A distinct uncached trip proves the negative branch without cache mutation hacks.
    const sold = trip(uuid(700), { seatsTotal: seats, seatsAvailable: 0 }); s.state.trips.set(sold.id, sold);
    await nav(s.page, `/trips/${sold.id}`, p => dialog(p, 'Поездка').getByText('Свободных мест нет', { exact: true }));
    assert.equal(await dialog(s.page, 'Поездка').getByRole('button', { name: /Забронировать место/ }).count(), 0);
  });
  for (const [id, status] of [[IDS.pending, 'Заявка отправлена'], [IDS.confirmed, 'Бронь подтверждена']]) await runCase(`cancellation-after-conditions-${id === IDS.pending ? 'pending' : 'confirmed'}`, 'Pinned conditions → driver comment → booking cancellation order; archive no cancel', async s => {
    // Arrange
    await nav(s.page, `/trips/${id}`, p => dialog(p, 'Поездка').getByText(status, { exact: true }));
    const root = dialog(s.page, 'Поездка');
    // Act
    const ordered = await root.evaluate(el => { const cancel = [...el.querySelectorAll('button')].find(b => b.textContent.includes('Отменить бронирование')); const comment = [...el.querySelectorAll('span')].find(n => n.textContent === 'Комментарий водителя')?.parentElement; const tags = [...el.querySelectorAll('ul')].find(n => n.textContent.includes('Тихая поездка')); if (!comment || !tags || !cancel) throw new Error('Missing conditions/comment/cancellation'); return [tags, comment].every(node => !!(node.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING)); });
    // Assert
    assert.ok(ordered); await visible(button(root, 'Отменить бронирование'));
    await closeSheet(s.page, 'Поездка');
    await nav(s.page, `/trips/${IDS.history}`, p => dialog(p, 'Поездка').getByText(/Завершена/));
    assert.equal(await button(dialog(s.page, 'Поездка'), 'Отменить бронирование').count(), 0);
  });
  await runCase('readable-names-history-window', 'U04/U10/U11: full identity/route/review cue/both window endpoints, not just aria text', async (s, record) => {
    // Arrange / Act
    record.measurements = [];
    const readable = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const m = await locator.evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const bounds = range.getBoundingClientRect(), lines = [...range.getClientRects()];
        const clipping = [];
        for (let n = el; n && !n.matches('main,[role="dialog"]'); n = n.parentElement) {
          const cs = getComputedStyle(n), r = n.getBoundingClientRect();
          if ((cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || (cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1)) clipping.push(n.className);
          if (['hidden', 'clip'].includes(cs.overflowX) && lines.some(line => line.left < r.left - 1 || line.right > r.right + 1)) clipping.push(n.className);
        }
        return { text: el.textContent, width: bounds.width, height: bounds.height, lines: lines.length, clipping };
      });
      record.measurements.push(m);
      // Assert
      assert.ok(m.width > 0 && m.height > 0 && m.clipping.length === 0, `Important data clipped: ${JSON.stringify(m)}`);
    };
    await nav(s.page, '/profile/blocked-users', p => button(p, `Разблокировать ${NAME}`));
    await readable(text(s.page, NAME)); await readable(text(s.page, OTHER_NAME));
    await hit44Round(button(s.page, `Разблокировать ${NAME}`));
    await nav(s.page, '/profile/history', p => p.getByText(/Оставьте отзыв/));
    await readable(s.page.getByRole('button', { name: /^Поездка .*Оставьте отзыв/ }).getByText('Вологда → Череповец', { exact: true }));
    await readable(s.page.getByText(/Оставьте отзыв/));
    await nav(s.page, '/profile/ride-requests', p => p.getByTestId(`ride-request-cell-${IDS.request}`));
    const row = s.page.getByTestId(`ride-request-cell-${IDS.request}`);
    const windowText = await row.getAttribute('aria-label');
    assert.ok(windowText.includes('6 ноября') && windowText.includes('8 ноября'), 'Accessible interval contains both endpoint dates');
    await readable(row.getByText(/6 ноября.*8 ноября/));
    assert.equal(await row.getByText(/неизвестный пользователь/i).count(), 0);
  }, { width: 320, theme: 'dark', platform: 'base' });
  await runCase('self-profile-readonly-nested-focus-hit44', 'U15/U23: own driver cannot block self; peer action available; nested Escape restores focus', async (s, record) => {
    // Arrange
    await nav(s.page, `/trips/${IDS.emptyOwn}`, p => button(dialog(p, 'Поездка'), 'Редактировать поездку'));
    const opener = button(dialog(s.page, 'Поездка'), `Открыть профиль: ${me.name}`);
    record.hit = await hit44(opener);
    // Act
    await opener.click(); await visible(dialog(s.page, 'Водитель').getByText(me.name, { exact: true }));
    // Assert
    assert.equal(await dialog(s.page, 'Водитель').getByRole('button', { name: /чёрный список/ }).count(), 0);
    assert.equal(s.requests.filter(r => r.path === `/blocks/${IDS.me}`).length, 0, 'No self-block status/mutation');
    await closeSheet(s.page, 'Водитель'); await visible(dialog(s.page, 'Поездка'));
    assert.ok(await opener.evaluate(el => document.activeElement === el), 'Nested close returns focus');
    await closeSheet(s.page, 'Поездка');
    await nav(s.page, `/trips/${IDS.free}`, p => button(dialog(p, 'Поездка'), `Открыть профиль: ${NAME}`));
    await button(dialog(s.page, 'Поездка'), `Открыть профиль: ${NAME}`).click();
    await visible(button(dialog(s.page, 'Водитель'), 'Добавить в чёрный список'));
    assert.equal(s.requests.filter(r => ['PUT', 'DELETE'].includes(r.method) && r.path.startsWith('/blocks/')).length, 0, 'Read-only case has no block mutation');
    await closeSheet(s.page, 'Водитель'); await closeSheet(s.page, 'Поездка');
    await nav(s.page, '/reviews', p => text(p, review.text));
    record.reviewHit = await hit44(button(s.page, `Открыть профиль: ${NAME}`));
  });
  await runCase('assertive-error-toast-semantic-icon', 'U16: actual portaled error feedback has alert role and error icon, not a success checkmark', async s => {
    await nav(s.page, `/trips/${IDS.own}`, p => button(dialog(p, 'Поездка'), 'Принять заявку Пассажир 1'));
    s.state.failures.push({ method: 'PATCH', path: `/bookings/${s.state.pending[0].id}/status`, status: 409, code: 'CONFLICT', once: true });
    await button(dialog(s.page, 'Поездка'), 'Принять заявку Пассажир 1').click();
    const toast = s.page.locator('[role="alert"][data-tone="error"]');
    await visible(toast);
    assert.equal(await toast.getAttribute('aria-live'), 'assertive');
    assert.equal(await toast.locator('.lucide-circle-alert').count(), 1);
    assert.equal(await toast.locator('.lucide-circle-check').count(), 0);
  });
  await runCase('auth-owner-refresh-remounts-private-observers', 'Privacy: genuine mocked auth refresh changes owner and never restores old profile data', async s => {
    await nav(s.page, '/profile', p => button(p, 'Редактировать профиль'));
    s.state.me = { ...s.state.me, id: uuid(900), name: 'Новый Владелец' };
    s.state.empty = true;
    s.state.ownTrips = [];
    s.state.summary = [];
    s.state.failures.push({ method: 'GET', path: '/trips/my', query: p => p.has('q'), status: 401, code: 'UNAUTHORIZED', once: true });
    const refreshed = s.page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/refresh' && r.status() === 200);
    await nav(s.page, '/bookings?segment=driver', p => p.locator('#bookings-search'));
    await s.page.locator('#bookings-search').fill('Свежий запрос владельца');
    await refreshed;
    await nav(s.page, '/profile/edit', p => dialog(p, 'Редактировать профиль').locator('#profile-name'));
    await valueIs(dialog(s.page, 'Редактировать профиль').locator('#profile-name'), 'Новый Владелец');
    assert.equal(await dialog(s.page, 'Редактировать профиль').getByText(me.name, { exact: true }).count(), 0);
  });
  await runCase('my-trip-search-page2-empty-reset', 'U08/U09: 21 trips, q match originally page2, server q/page1, empty/reset retain access', async s => {
    // Arrange
    await nav(s.page, '/bookings?segment=driver', p => p.locator('#bookings-search'));
    await visible(s.page.getByText('Нижний Новгород', { exact: true }));
    // Act
    const sent = s.page.waitForRequest(req => new URL(req.url()).pathname === '/api/v1/trips/my' && new URL(req.url()).searchParams.get('q') === 'совпадениенавторойстранице');
    await s.page.locator('#bookings-search').fill('СовпадениеНаВторойСтранице'); await sent;
    // Assert
    await visible(s.page.getByText('СовпадениеНаВторойСтранице', { exact: true }));
    assert.ok(s.requests.some(r => r.path === '/trips/my' && new URLSearchParams(r.query).get('q') === 'совпадениенавторойстранице' && new URLSearchParams(r.query).get('page') === '1'));
    await s.page.locator('#bookings-search').fill('НетСовпадений'); await visible(button(s.page, 'Сбросить поиск'));
    await button(s.page, 'Сбросить поиск').click(); await visible(s.page.getByText('Нижний Новгород', { exact: true }));
    assert.equal(await s.page.locator('#bookings-search').inputValue(), '');
  });
  await runCase('per-trip-51-fetchmore-error-retry', 'Extra/U19: summary take50 does not truncate details; next-page error preserves rows and explicit retry', async s => {
    // Arrange
    const path = `/bookings/trip/${IDS.own}`;
    s.state.failures.push({ method: 'GET', path, query: p => p.has('cursor'), status: 409, once: true });
    await nav(s.page, `/trips/${IDS.own}`, p => dialog(p, 'Поездка').getByText('Пассажир 1', { exact: true }));
    const root = dialog(s.page, 'Поездка');
    // Act
    await button(root, 'Показать ещё пассажиров').click(); await visible(root.getByRole('alert').filter({ hasText: 'Не удалось загрузить ещё' }));
    // Assert
    await visible(root.getByText('Пассажир 1', { exact: true }));
    assert.equal(await root.getByText('Пассажир номер 51', { exact: true }).count(), 0);
    assert.equal(s.requests.filter(r => r.path === path && r.query.includes('cursor=')).length, 1, 'No endless auto retry after 409');
    await button(root, 'Повторить загрузку').click(); await visible(root.getByText('Пассажир номер 51', { exact: true }));
    assert.equal(await root.getByRole('button', { name: /^Открыть профиль: Пассажир/ }).count(), 51);
    assert.equal(await button(root, 'Показать ещё пассажиров').count(), 0);
  });
  await runCase('passenger-initial-error-local-retry', 'U19: passenger retry calls per-trip endpoint, not global summary', async s => {
    // Arrange
    const path = `/bookings/trip/${IDS.own}`;
    const failure = { method: 'GET', path, status: 409 };
    s.state.failures.push(failure);
    await nav(s.page, `/trips/${IDS.own}`, p => button(dialog(p, 'Поездка'), 'Повторить загрузку пассажиров'));
    const summary = s.requests.filter(r => r.path === '/bookings/driver').length;
    const beforeRetry = s.requests.filter(r => r.path === path).length;
    s.state.failures = s.state.failures.filter(f => f !== failure);
    // Act
    await button(dialog(s.page, 'Поездка'), 'Повторить загрузку пассажиров').click();
    // Assert
    await visible(dialog(s.page, 'Поездка').getByText('Пассажир 1', { exact: true }));
    assert.equal(s.requests.filter(r => r.path === path).length, beforeRetry + 1);
    assert.equal(s.requests.filter(r => r.path === '/bookings/driver').length, summary);
  });
  await runCase('request-live-expiry-clock', 'Extra: expiry crosses while open with no unrelated rerender/request', async s => {
    // Arrange
    await nav(s.page, '/profile/support', p => button(p, 'Создать обращение'));
    s.state.requests[0].expiresAt = new Date(await s.page.evaluate(() => Date.now()) + 60000).toISOString();
    await nav(s.page, '/profile/ride-requests', p => p.getByTestId(`ride-request-cell-${IDS.request}`));
    await s.page.getByTestId(`ride-request-cell-${IDS.request}`).click();
    const root = dialog(s.page, 'Запрос на попутку'); await visible(button(root, 'Редактировать'));
    const before = s.requests.filter(r => r.path === '/ride-requests').length;
    // Act: the controllable clock was installed before application timers existed.
    await s.page.clock.fastForward(61000);
    // Assert
    await visible(root.getByText('Срок действия истёк — создайте новый запрос.', { exact: true }));
    assert.equal(await button(root, 'Редактировать').count(), 0); assert.equal(await button(root, 'На паузу').count(), 0);
    assert.equal(s.requests.filter(r => r.path === '/ride-requests').length, before);
  }, { width: 390, theme: 'light', platform: 'base', clock: true });
  await runCase('edit-comment-empty-and-duration', 'U06: empty PATCH is intentional clear; invalid departure does not mutate', async s => {
    // Arrange
    await nav(s.page, `/trips/${IDS.emptyOwn}`, p => button(dialog(p, 'Поездка'), 'Редактировать поездку'));
    await button(dialog(s.page, 'Поездка'), 'Редактировать поездку').click();
    await valueIs(s.page.locator('#edit-duration'), '110');
    // Act
    await s.page.locator('#edit-departure').fill('2026-01-01T12:00'); await button(dialog(s.page, 'Поездка'), 'Сохранить').click();
    // Assert
    await visible(text(s.page, 'Укажите будущие дату и время отправления'));
    assert.equal(s.requests.filter(r => r.method === 'PATCH').length, 0);
    await s.page.locator('#edit-departure').fill('2026-11-06T12:00'); await s.page.locator('#edit-comment').fill('');
    const sent = waitRequest(s, 'PATCH', `/trips/${IDS.emptyOwn}`); await button(dialog(s.page, 'Поездка'), 'Сохранить').click(); await sent;
    const payload = s.requests.find(r => r.method === 'PATCH').body; assert.ok(Object.hasOwn(payload, 'comment')); assert.equal(payload.comment, ''); assert.equal(payload.durationMinutes, 110);
  });
  await runCase('request-pending-guard-error-retry', 'U07: pending blocks duplicate save; failure retains draft and allows retry', async s => {
    // Arrange
    await nav(s.page, '/profile/ride-requests', p => p.getByTestId(`ride-request-cell-${IDS.request}`));
    await s.page.getByTestId(`ride-request-cell-${IDS.request}`).click(); const root = dialog(s.page, 'Запрос на попутку');
    await button(root, 'Редактировать').click(); await s.page.locator(`#ride-edit-seats-${IDS.request}`).fill('2');
    const path = `/ride-requests/${IDS.request}`;
    // Act
    await heldSubmission(s, 'PATCH', path, () => button(root, 'Сохранить').click());
    await disabled(button(root, 'Сохранить'));
    await button(root, 'Сохранить').evaluate(el => el.click());
    // Assert
    assert.ok(await button(root, 'Сохранить').isDisabled()); assert.equal(s.requests.filter(r => r.method === 'PATCH').length, 1);
    await release(s, 'PATCH', path); await visible(button(root, 'Редактировать'));
    await button(root, 'Редактировать').click(); await s.page.locator(`#ride-edit-seats-${IDS.request}`).fill('1');
    s.state.failures.push({ method: 'PATCH', path, status: 409, once: true });
    await button(root, 'Сохранить').click(); await visible(root.getByText(/Синтетическая ошибка|повтор|изменил|конфликт/i));
    await valueIs(s.page.locator(`#ride-edit-seats-${IDS.request}`), '1'); assert.ok(await button(root, 'Сохранить').isEnabled());
    await button(root, 'Сохранить').click(); await visible(button(root, 'Редактировать'));
  });
  for (const [name, path, api] of [['profile', '/profile', '/users/me'], ['notifications', '/notifications', '/notifications/my']]) await runCase(`${name}-loading-error-geometry-recovery`, 'Extra: actual cold loading/error geometry and successful local retry', async (s, record) => {
    // Arrange
    const ready = defer(s, 'GET', api, true);
    const requested = waitRequest(s, 'GET', api);
    await s.page.goto(`${BASE}/#${path}`, { waitUntil: 'domcontentloaded' });
    await visible(s.page.getByRole('status').first());
    // Act: release a deliberately delayed read, then start an independent cold error context.
    await Promise.all([ready, requested]);
    record.loading = await geometry(s.page, 0);
    await release(s, 'GET', api);
    await visible(name === 'profile' ? button(s.page, 'Редактировать профиль') : text(s.page, 'Бронь подтверждена'));
    const failing = await session({ width: 320, theme: 'dark', platform: 'ios' });
    try {
      failing.state.failures.push({ method: 'GET', path: api, status: 429 });
      await nav(failing.page, path, p => button(p, 'Повторить'), true);
      record.errorGeometry = await geometry(failing.page, 1);
      // Assert
      assert.equal(record.errorGeometry.documentOverflow, false); assert.equal(record.errorGeometry.overflow.length, 0);
      assert.ok(record.errorGeometry.lastControl.visible && record.errorGeometry.lastControl.hit);
      failing.state.failures = [];
      await button(failing.page, 'Повторить').click();
      await visible(name === 'profile' ? button(failing.page, 'Редактировать профиль') : text(failing.page, 'Бронь подтверждена'));
    } finally { await failing.close(); }
  });
  for (const [name, path, api] of [['profile', '/profile', '/users/me'], ['notifications', '/notifications', '/notifications/my']]) await runCase(`${name}-refetch-error-retains-content`, 'Extra: failed stale refetch keeps existing data and offers a resource-specific retry', async s => {
    const content = name === 'profile' ? me.name : 'Бронь подтверждена';
    await nav(s.page, path, p => text(p, content));
    await nav(s.page, '/profile/support', p => button(p, 'Создать обращение'));
    const failure = { method: 'GET', path: api, status: 429 };
    s.state.failures.push(failure);
    await s.page.clock.setFixedTime(new Date(NOW.getTime() + 61000));
    const retry = name === 'profile' ? 'Повторить обновление профиля' : 'Повторить обновление уведомлений';
    await nav(s.page, path, p => button(p, retry));
    await visible(text(s.page, content));
    s.state.failures = s.state.failures.filter(f => f !== failure);
    await button(s.page, retry).click();
    await button(s.page, retry).waitFor({ state: 'detached' });
    await visible(text(s.page, content));
  });
  await runCase('404-deep-link-and-malformed-route', 'Cold 404 has exit/no futile retry; malformed hash renders actual home', async s => {
    // Arrange / Act
    await nav(s.page, `/trips/${uuid(999)}`, p => button(dialog(p, 'Поездка'), 'К поиску'), true);
    // Assert
    assert.equal(await button(dialog(s.page, 'Поездка'), 'Повторить').count(), 0);
    await button(dialog(s.page, 'Поездка'), 'К поиску').click(); await visible(button(s.page, 'Найти'));
    await nav(s.page, '/not-a-real-route', p => button(p, 'Ищу попутку'));
    assert.equal(new URL(s.page.url()).hash, '#/');
  });
  for (const status of [409, 429]) await runCase(`support-mutation-${status}-then-success`, 'Error tone/geometry, retained input, retry success (all POSTs fulfilled)', async s => {
    // Arrange
    await nav(s.page, '/profile/support', p => button(p, 'Создать обращение'));
    await button(s.page, 'Создать обращение').click(); const root = dialog(s.page, 'Создать обращение');
    await s.page.locator('#support-subject').fill('Проверка ошибки'); await s.page.locator('#support-text').fill('Синтетический текст для повтора');
    s.state.failures.push({ method: 'POST', path: '/feedback', status, once: true });
    // Act
    await button(root, 'Отправить').click(); await visible(root.getByRole('alert').first());
    // Assert
    await valueIs(s.page.locator('#support-text'), 'Синтетический текст для повтора');
    assert.ok(await button(root, 'Отправить').isEnabled());
    const alerts = await root.getByRole('alert').allTextContents(); assert.ok(alerts.every(t => !t.includes('отправлено!')));
    await button(root, 'Отправить').click(); await root.waitFor({ state: 'detached' });
    await visible(s.page.getByRole('status').filter({ hasText: 'Обращение отправлено!' }));
    assert.deepEqual(s.requests.filter(r => r.method === 'POST' && r.path === '/feedback').map(r => r.status), [status, 200]);
  });
  await runCase('offline-sheet-reconnect-and-keyboard', 'U21: offline announcement inside modal; single page banner; Tab trapped; switcher arrows', async s => {
    // Arrange
    await nav(s.page, '/bookings', p => p.locator('#bookings-search'));
    const driver = s.page.getByRole('radio', { name: 'Водитель', exact: true });
    await driver.click();
    await s.page.waitForFunction(() => document.querySelector('#booking-segment-driver')?.getAttribute('aria-checked') === 'true');
    await driver.focus(); await s.page.keyboard.press('ArrowRight');
    await s.page.waitForFunction(() => document.querySelector('#booking-segment-passenger')?.getAttribute('aria-checked') === 'true');
    await nav(s.page, `/trips/${IDS.confirmed}`, p => dialog(p, 'Поездка').getByText('Бронь подтверждена', { exact: true }));
    const root = dialog(s.page, 'Поездка');
    // Act
    await s.context.setOffline(true); await visible(root.getByText(/Нет подключения/));
    await s.page.keyboard.press('Tab');
    // Assert
    assert.ok(await root.evaluate(el => el.contains(document.activeElement)), 'Tab remains in sheet');
    await s.context.setOffline(false); await visible(root.getByText(/Соединение восстановлено/));
    await closeSheet(s.page, 'Поездка');
    await s.context.setOffline(true); assert.equal(await s.page.getByText(/Нет подключения/).count(), 1, 'Ordinary page must not duplicate offline banner');
    await s.context.setOffline(false);
  });
  await runCase('empty-and-zero-count-not-unknown', 'U20: explicit empty state/zero counts; failed count never claims zero', async (s, record) => {
    // Arrange
    s.state.empty = true; s.state.unread = 0;
    await nav(s.page, '/notifications', p => p.getByText('Пока нет уведомлений', { exact: true }));
    assert.ok(await button(s.page, 'Все уведомления прочитаны').isDisabled());
    // Act
    await nav(s.page, '/', p => button(p, 'Ищу попутку'));
    // Assert
    assert.equal(await s.page.getByRole('button', { name: /Уведомления.*101/ }).count(), 0);
    const zero = s.page.locator('[data-tone="zero"]');
    await visible(zero.first());
    assert.equal(await zero.count(), 3, 'Three explicit zero counters, not missing fixture UI');
    await zero.first().scrollIntoViewIfNeeded();
    record.zeroContrast = (await contrast(s.page)).filter(sample => sample.kind === 'badge' && sample.text === '0');
    assert.ok(record.zeroContrast.length >= 3 && record.zeroContrast.every(sample => sample.opaque && sample.ratio >= 4.5), 'Dark zero badges require composed contrast');
    const failed = await session();
    try {
      failed.state.failures.push({ method: 'GET', path: '/notifications/unread-count', status: 429 });
      await nav(failed.page, '/notifications', p => text(p, 'Бронь подтверждена'));
      assert.equal(await failed.page.getByRole('button', { name: /Прочитать все.*0/ }).count(), 0, 'Unknown count is not announced as zero');
      await visible(button(failed.page, 'Прочитать все'));
      assert.ok(await button(failed.page, 'Прочитать все').isEnabled());
      assert.equal(await button(failed.page, 'Все уведомления прочитаны').count(), 0);
    } finally { await failed.close(); }
  }, { width: 320, theme: 'dark', platform: 'base' });
}

try {
  // Arrange: self-check the fixtures/dispatch boundary before launching a browser.
  const f = fixtures();
  assert.equal(respond(f, 'GET', '/not-a-known-api', new URLSearchParams(), {}), null);
  assert.equal(respond(f, 'POST', '/auth/ws-ticket', new URLSearchParams(), {}).status, 503);
  assert.equal(offset(f.ownTrips, 1, 20).pagination.hasMore, true);
  assert.equal(cursor(f.pending).pagination.hasMore, true);
  // Act / Assert: independent matrix and named positive/negative regression cases.
  browser = await chromium.launch({ headless: true });
  await matrix();
  await drafts();
  await regressions();
} catch (error) { results.fatal = error.stack || error.message; }
finally {
  if (browser) await browser.close();
  results.summary = { matrixPassed: results.matrix.filter(r => r.status === 'passed').length, matrixFailed: results.matrix.filter(r => r.status !== 'passed').length, casesPassed: results.cases.filter(r => r.status === 'passed').length, casesFailed: results.cases.filter(r => r.status !== 'passed').length, unknownApi: results.unknownApi.length, fixtureErrors: results.fixtureErrors.length, pageErrors: results.pageErrors.length, unhandledRejections: results.rejections.length, untested: results.untested.length };
  results.status = results.fatal || results.summary.matrixFailed || results.summary.casesFailed || results.summary.unknownApi || results.summary.fixtureErrors || results.summary.pageErrors || results.summary.unhandledRejections || results.blockedExternal.length ? 'failed' : 'passed-with-explicit-untested';
  results.coverageStatus = 'partial-not-task22-signoff';
  results.completedAt = new SystemDate().toISOString();
  results.coverage = {
    U01_U02_U03: 'Composed text/button/subtitle/placeholder contrast on actual loaded matrix surfaces; not every variant/state combination.',
    U04_U10_U11_U12_U13: 'Names/history/window and tab label cases plus route geometry; profile-menu title-specific clipping is not separately gated.',
    U05_U06_U07: 'Nine draft forms: actual detach/reopen, late success cleanup/newer revision; booking comment retention/error/success; empty driver comment and 110 minutes; pending request guard/retry.',
    U08_U09: '21 own trips, server q with original page2 match, pagination hasMore/error/retry/reset, own trip without pending still visible.',
    U14_U16_U17_U18: 'Portaled assertive error-toast semantics/icon are exercised. FAQ and haptic/share logic have unit tests; physical haptics/native sharing remain manual.',
    U15_U19_U20_U21_U22_U23: 'Read-only self profile, per-trip retry and 51 pending pagination, zero/unknown/99+ counters, modal offline/reconnect, primary request publish, driver/review/unblock effective 44px pointer targets.',
    extras: 'Controlled live expiry, initial loading/error Profile/Notifications geometry, 404/409/429, deep links/malformed fallback, nested close/focus and Tab/arrow navigation. Refetch permutations/native devices remain explicitly unverified.',
  };
  await writeFile(`${OUT}/browser-results.json`, JSON.stringify(results, null, 2));
  console.info(JSON.stringify({ status: results.status, ...results.summary, report: `${OUT}/browser-results.json` }, null, 2));
  if (results.status === 'failed') process.exitCode = 1;
  globalThis.Date = SystemDate;
}
