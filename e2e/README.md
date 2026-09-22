# E2E Tests

Telegram Mini App parity E2E (tg-migration-17): Playwright + Chromium journey plus realtime check.

## Prerequisites

- Telegram frontend on `E2E_TG_URL` (default `http://localhost:3012`,
  `telegram-app` vite dev server)
- Backend running on `http://localhost:3011`
- Dev DB running (docker container `E2E_DB_CONTAINER`, default `edem-db-dev`)
- `ALLOW_DEV_AUTH=true` in backend `.env`
- Admin token in `E2E_ADMIN_TOKEN` (default `dev-admin-token-12345`, must match
  backend `ADMIN_TOKEN`) for review approve + feedback reply steps
- Playwright browsers installed: `npx playwright install chromium`

## Running

```bash
node e2e/telegram-parity.mjs

# Realtime smoke (ws.v1 auth/ping-pong/reconnect against a live backend)
node e2e/telegram-realtime.mjs
```

## Env overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `E2E_TG_URL` | `http://localhost:3012` | Telegram frontend base URL |
| `E2E_DB_CONTAINER` | `edem-db-dev` | Docker container for time-travel (`departureAt`) + cleanup |
| `E2E_VERBOSE` | unset (`1` = verbose) | Log screenshot-helper failures instead of failing the step |
| `E2E_API_URL` | `http://localhost:3011/api/v1` | Backend API base |
| `E2E_ADMIN_TOKEN` | `dev-admin-token-12345` | Admin API (must match backend `ADMIN_TOKEN`) |

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
  at 16/16). Rejections are collected per page via an init script and
  reported in `results-tg.json`.
- Cold-start warm-up: one non-counted `goto /` + 120s content wait right after
  browser launch absorbs fresh-vite compile latency.
- No swallowed waits on key assertions — missing UI state fails the step
  loudly. `page.reload()` tests real server resync (not cache).
- Mobile leg resizes the viewport in the same context (a new context would
  burn the shared `/auth/telegram` IP budget on re-bootstrap).

## Test Flow (`telegram-parity.mjs` runSteps in order)

1. Prereq: TG frontend serves the app (with cold-start warm-up)
2. Auth: dev login, `Dev Telegram` profile (onboarding accepted once)
3. Setup: driver car (psql upsert), directory cities, API counterparty
4. Driver creates trip in UI (unique price, datalist cities) → `/trips/:id`
5. Counterparty books seat 1 via API
6. Driver approves (`Принять` → `Подтверждён`) in UI
7. Inbox shows `booking_created`; mark-read works
8. Reload on requests page → confirmed state resyncs from server
9. Offline → `Нет подключения` banner; online → `Соединение восстановлено`
10. Time-travel departure to past (docker psql) → UI complete → `Завершена`
11. Counterparty review via API → admin approve → visible in UI `/reviews`
12. Support ticket in UI → admin reply via API → `Ответ поддержки` in UI
13. Settings toggle round-trip (`Настройки сохранены`)
14. Malformed hash route falls back to search (`/trips`)
15. 390px viewport resize: search finds counterparty trip card
16. UI account deletion → `Профиль удалён` screen (tombstone)

## Artifacts

- Screenshots: `e2e/shots-tg/`
- Results: `e2e/results-tg.json`
