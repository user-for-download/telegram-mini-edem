# E2E Tests

Telegram Mini App parity E2E: Playwright + Chromium journeys, plus realtime and UI-guard checks.

Отдельно `ui-cascade.mjs` — не journey, а проверка каскада: берёт
`getComputedStyle` карточки и док таббара и сверяет с «Реестром отклонений»
в `telegram-app/src/ui/README.md`. Существует потому, что vitest читает текст
CSS, а не результат: правило может быть корректным и при этом не применяться
(так был сломан `ui/Card`). Требует только поднятый стенд, без сценариев и
записей в БД.

`ui-contrast.mjs` — тот же приём для контраста: считает WCAG по
**фактически вычисленному** цвету. vitest здесь бессилен дважды: jsdom не
резолвит каскадный `color-mix(in srgb, …)`, а значения `--tgui--*`
принадлежат киту, и копировать их в тест значит завести второй источник
правды. Поэтому числовая граница живёт здесь, а в vitest остаётся
структурный пин (`ui/__tests__/fieldLabelTone.test.tsx`): токен объявлен в
обеих темах, смешивается к нужному токену, процент не ниже минимума.

Порог выводится из размера и веса, а не задаётся списком: 4.5:1 для
обычного текста, 3:1 для крупного (≥24px либо ≥18.66px при 600+). Иначе
подняли бы размер на 1px и получили «проходит» там, где обычный текст.
Шаги с заранее известным носителем (тон на плашке, плашка Notice) дублируют
этот порог **абсолютным полом** `minRatio`: полагаться на одну лишь эвристику
кегля значило бы завтра пропустить просадку у тона, который «вроде крупный».

Шаг «тёмная тема перекрывает тон» сравнивает **разрешённые** цвета в обеих
темах, а не строки вывода движка: один и тот же цвет он отдаёт то как
`rgb(135,152,169)`, то как `color(srgb 0.529 0.595 0.664)`. Числовой пол сам
по себе не доказывает, что `.dark .app-theme` применился — «4.5 не упало»
одинаково верно и при живом оверрейде, и при сломанном; доказательство —
именно разница значений.

Отдельный скрипт, а не шаг `telegram-parity.mjs`: падение контраста не
должно ронять продуктовый прогон.

`ui-rhythm.mjs` — тот же приём для рёбер экрана: обходит корневые табы и
подстраницы профиля, сверяет `getComputedStyle` корня `Page` с токенами
`--app-page-*` и меряет фактические бока первого блока плюс нижний зазор до
док таббара на докрученной странице. Существует потому, что текстовый пин
видит, что правило написано верно, но не видит ни «применилось ли оно», ни
«одинаково ли на всех маршрутах». Эталон берётся с первого маршрута и
сверяется с токенами, а не только «все одинаковы» — иначе общее отклонение
прошло бы как «одинаковое». Вне охвата остаются hero-экраны, шторки и
терминальные экраны: у них другой низ и своя геометрия по устройству.

`ui-demand-static.mjs` — пинит витрину спроса («Кто ищет попутку»): строка —
информация, а не ссылка. В браузере проверяет то, чего не видит jsdom: курсор
не `pointer`, на наведении нет подложки, клик никуда не ведёт. Закрывает
китовую ложную аффорданс `Cell` (всегда тянет `Tappable`) через
`STATIC_CELL` из `@/ui/classes`; реестр отклонений — `ui/README.md` #33.

## Prerequisites

- Telegram frontend on `E2E_TG_URL` (default `http://localhost:3012`,
  `telegram-app` vite dev server)
- Backend running on `http://localhost:3011`
- Dev DB running (docker container `E2E_DB_CONTAINER`, default `edem-db-dev`)
- `ALLOW_DEV_AUTH=true` in backend `.env` **and** the dev user's Telegram id in
  `DEV_AUTH_USER_ALLOWLIST` (the bypass only works for allowlisted ids)
- Admin token in `E2E_ADMIN_TOKEN` (default `dev-admin-token-12345`, must match
  backend `ADMIN_TOKEN`) for review approve + feedback reply steps
- Playwright browsers installed: `npx playwright install chromium`

## Running

```bash
node e2e/telegram-parity.mjs

# Realtime smoke (ws.v1 auth/ping-pong/reconnect against a live backend)
node e2e/telegram-realtime.mjs

# UI-каскад: замер getComputedStyle в браузере (Card/таббар, реестр отклонений)
node e2e/ui-cascade.mjs

# Контраст: WCAG по вычисленному цвету (подпись поля, тона Notice,
# --app-muted, --app-info на своей плашке — каждая пара в ОБЕИХ темах)
node e2e/ui-contrast.mjs

# Ритм: рёбра экранов (padding корня Page по токенам, бока, низ до дока)
node e2e/ui-rhythm.mjs

# Витрина спроса: строка не выглядит кликабельной (курсор/подложка/клик)
node e2e/ui-demand-static.mjs
```

Контрастный скрипт печатает подробные замеры с `E2E_CONTRAST_VERBOSE=1`.

## Env overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `E2E_TG_URL` | `http://localhost:3012` | Telegram frontend base URL |
| `E2E_DB_CONTAINER` | `edem-db-dev` | Docker container for time-travel (`departureAt`) + cleanup |
| `E2E_VERBOSE` | unset (`1` = verbose) | Log screenshot-helper failures instead of failing the step |
| `E2E_API_URL` | `http://localhost:3011/api/v1` | Backend API base |
| `E2E_ADMIN_TOKEN` | `dev-admin-token-12345` | Admin API (must match backend `ADMIN_TOKEN`) |
| `E2E_CONTRAST_VERBOSE` | unset (`1` = verbose) | Print every contrast measurement in `ui-contrast.mjs` |
| `TG_BASE_URL` | `http://localhost:3011` | Backend base for `telegram-realtime.mjs` |

Rate budget: `/auth/telegram` is IP-limited (default 5/5min, shared by UI
bootstraps and API logins). The script uses exactly one login per identity
per run (UI bootstrap, peer API, page reloads re-bootstrap from storage) —
back-to-back reruns within 5 minutes may hit 429. Wait out the window or
raise `TG_AUTH_RATE_MAX` on the dev backend.

## Determinism

- Each run uses unique data: `PRICE = 700 + ((Date.now() + pid) % 90)` plus
  unique review/feedback texts and directory cities, so repeat runs never
  collide on cards/search. The created trip `id` is captured from the URL
  after UI publish — assertions key on the exact entity.
- Prerequisite check runs first: `docker exec $E2E_DB_CONTAINER psql` must
  answer, otherwise the run exits 2 before creating any data.
- Created trips + peer user + feedback are deleted in a `finally` block
  (pass or fail). **Cleanup failure fails the run**, so residue never leaks
  into the next run silently.
- `pageerror` **and** `unhandledrejection` fail the run (non-zero exit even
  at 17/17). Rejections are collected per page via an init script and
  reported in `results-tg.json`.
- Cold-start warm-up: one non-counted `goto /` + 120s content wait right after
  browser launch absorbs fresh-vite compile latency.
- No swallowed waits on key assertions — missing UI state fails the step
  loudly. `page.reload()` tests real server resync (not cache).
- Mobile leg resizes the viewport in the same context (a new context would
  burn the shared `/auth/telegram` IP budget on re-bootstrap).
- City seeding happens before browser launch: the city directory is cached
  client-side (`useAllCitiesQuery`, `staleTime: Infinity`), so seeding after
  the first render never reaches the dropdown. Seed is idempotent
  (`ON CONFLICT (nameNormalized) DO NOTHING` + SELECT id).
- Multiselect option clicks use `force: true`: tgui covers option rows with
  its own state-layer (`absolute inset-0`, real taps bubble fine), which
  Playwright's strict hit-target check rejects.
- After the run `restoreDevStand()` reseeds the dev stand: the delete-profile
  step wipes the dev user's notifications, and `reviveDevUser()` alone would
  leave it with 0 instead of the seeded inbox.

## Test Flow (`telegram-parity.mjs` runSteps in order, 17)

1. Prereq: TG frontend serves the app (with cold-start warm-up)
2. Auth: dev login, `Dev Telegram` profile (onboarding accepted once)
3. Prereq: notifications enabled for the dev user
4. Setup: driver car (psql upsert), directory cities, API counterparty
5. Driver creates trip in UI (unique price, datalist cities) → `/trips/:id`
6. Counterparty books seat 1 via API
7. Driver approves (`Принять` → `Подтверждён`) in UI
8. Inbox shows `booking_created`; mark-read works
9. Reload on requests page → confirmed state resyncs from server
10. Offline → `Нет подключения` banner; online → `Соединение восстановлено`
11. Time-travel departure to past (docker psql) → UI complete → `Завершена`
12. Counterparty review via API → admin approve → visible in UI `/reviews`
13. Support ticket in UI → admin reply via API → `Ответ поддержки` in UI
14. Settings toggle round-trip (`Настройки сохранены`)
15. Malformed hash route falls back to the home page (`/`)
16. 390px viewport: search finds the counterparty trip card
17. UI account deletion → `Профиль удалён` screen (tombstone)

## Artifacts

- Screenshots: `e2e/shots-tg/` (parity), `e2e/shots-realtime/` (realtime)
- Results: `e2e/results-tg.json`
