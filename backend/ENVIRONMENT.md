# Backend environment variables

Source of truth: `backend/src/env.ts` (the only place that reads
`process.env`). Unset variables use the defaults below. `.env.example` in the
repo root is for Docker Compose, `backend/.env.example` is for the local
backend.

## Numeric values

Every numeric setting must be a positive safe integer. Zero, negative,
fractional, partially numeric and out-of-range values stop startup with the
variable name instead of silently changing runtime behavior.

This applies to `PORT`/`BACKEND_PORT`, every `*_TTL_SECONDS`, every
`*_RATE_WINDOW_MS`/`*_RATE_MAX`, `TG_NOTIFICATION_*` and
`TG_INIT_DATA_TTL_SECONDS`.

`NODE_ENV=development` multiplies every `*_RATE_MAX` default by **100**
(`devRateMax`): the dev stand shares one IP budget (Vite proxy, HMR reloads,
e2e runs). An explicit env value always wins, `NODE_ENV=test` keeps the strict
production defaults, production is unchanged.

## Server

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string for the pg driver adapter (`src/db.ts`) |
| `PORT` | `3000` | HTTP port in production |
| `BACKEND_PORT` | `3001` | HTTP port outside production (dev stand) |
| `NODE_ENV` | unset | `production` enables strict secrets, `PORT`, `Secure` cookies; `development` enables the rate multiplier and ephemeral dev secrets; `test` is strict |
| `TRUST_PROXY` | `false` | Trust `X-Real-IP` / `X-Forwarded-For` and, for WS origin checks, `X-Forwarded-Host`. **Required behind a reverse proxy** that rewrites those headers; otherwise all clients share one IP bucket. WS also trusts `X-Forwarded-Host` from a loopback peer (local Vite/nginx) even when `false` |
| `LOG_LEVEL` | `info` (prod), `debug` (dev) | pino level |
| `TZ` | `Europe/Moscow` (container) | Moscow dates in serializers, workers and seeds |

`DATABASE_URL` is always required (no fallback). In production `JWT_SECRET`
and `CORS_ORIGINS` are required too; in development unset secrets are generated
ephemerally with a warning (`[env] … Generated ephemeral development secret`).

## Auth

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | required in production | HS256 key for user access tokens and the admin JWT |
| `JWT_ACCESS_TTL_SECONDS` | `900` (15 min) | Access-token lifetime |
| `JWT_REFRESH_TTL_SECONDS` | `2592000` (30 days) | Refresh-token lifetime |
| `TG_INIT_DATA_TTL_SECONDS` | `3600` | Freshness window of Telegram `initData` (anti-replay) |
| `TELEGRAM_BOT_TOKEN` | empty | Bot token for HMAC validation of `initData`. Empty → `POST /auth/telegram` answers `503` (dev bypass may still work) |
| `TELEGRAM_WEBHOOK_SECRET` | ephemeral in dev | Secret in the bot webhook path `POST /bot/webhook/:secret`; required in production |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001` (dev); required in production | Comma-separated allowed origins |
| `ADMIN_TOKEN` | empty | Static admin-panel token. Empty → the whole `/api/v1/admin/*` is closed with `403`, in any environment |
| `ADMIN_JWT_TTL_SECONDS` | `43200` (12 h) | Admin session cookie TTL (no refresh tokens) |
| `ALLOW_DEV_AUTH` | `false` | Dev-only (`NODE_ENV=development\|test`): `hash=dev-hash` initData bypass and mock refresh tokens. Ignored with a warning in any other environment |
| `DEV_AUTH_USER_ALLOWLIST` | empty | Comma-separated ids allowed to use dev auth: internal `user.id` (UUID) for mock tokens, Telegram numeric id for the initData bypass. Empty = dev mechanisms disabled |
| `DEV_MOCK_TOKEN_TTL_SECONDS` | `900` (15 min) | TTL of `mock-access-token-<id>` / `mock-refresh-token-<id>` |

## Auth rate limits

Auth endpoints use independent IP-based limiters:

| Variable pair | Endpoint | Default (production) |
|---|---|---|
| `TG_AUTH_RATE_WINDOW_MS` / `TG_AUTH_RATE_MAX` | `POST /api/v1/auth/telegram` | 5 minutes / 5 requests |
| `REFRESH_RATE_WINDOW_MS` / `REFRESH_RATE_MAX` | `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` | 10 minutes / 10 requests |
| `ADMIN_LOGIN_RATE_WINDOW_MS` / `ADMIN_LOGIN_RATE_MAX` | `POST /api/v1/admin/auth/login` | 5 minutes / 5 requests |

The former single `AUTH_RATE_WINDOW_MS`/`AUTH_RATE_MAX` pair is not read at all;
leftovers in an old `.env` change nothing.

## General rate limits

Two families:

- **IP-based** — shared by all clients behind the same address:
  `PUBLIC_READ_*` (60 s / 100) for public lists and reads,
  `MUTATION_*` (60 s / 30) for authenticated writes,
  `ADMIN_READ_*` (60 s / 300) for admin GETs,
  `CLIENT_ERRORS_*` (60 s / 10) and `BOT_WEBHOOK_*` (60 s / 120).
- **User-based** — daily budgets for expensive account actions:

| Variable pair | Action | Default (production) |
|---|---|---|
| `CREATE_TRIP_RATE_*` | Create a trip | 24 h / 10 |
| `CANCEL_TRIP_RATE_*` | Cancel a trip | 24 h / 20 |
| `COMPLETE_TRIP_RATE_*` | Complete a trip | 24 h / 20 |
| `CREATE_BOOKING_RATE_*` | Book a seat | 24 h / 20 |
| `CANCEL_BOOKING_RATE_*` | Cancel a booking | 24 h / 20 |
| `BOOKINGS_READ_RATE_*` | Read own bookings | 60 s / 200 |
| `PROFILE_UPDATE_RATE_*` | Edit profile / car | 24 h / 50 |
| `NOTIFICATION_READ_RATE_*` | Mark notifications read | 24 h / 100 |
| `REVIEWS_READ_RATE_*` | Read own reviews | 24 h / 100 |
| `FEEDBACK_READ_RATE_*` | Read own feedback | 24 h / 100 |
| `FEEDBACK_CREATE_RATE_*` | Create feedback | 1 h / 10 |

## Telegram frontend and bot API

| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_HOSTS` | empty | Comma-separated hosts that receive `telegram-app/dist` (Host routing in `app.ts`). Empty = the Mini App answers `404` |
| `TELEGRAM_WEBAPP_URL` | empty | `https://t.me/...` or a direct HTTPS domain for the “Open” button (`web_app`) in bot messages. Empty = text-only messages |
| `TELEGRAM_API_PROXY` | empty | `socks5://host:port` for outgoing `api.telegram.org` calls. Dev usually needs it; production usually does not |
| `TELEGRAM_DELIVERY_ENABLED` | `true` | Kill-switch for Bot API delivery: `false` marks outbox tasks `skipped/channel_disabled`; the in-app inbox keeps working |

## Telegram notification outbox

| Variable | Default | Purpose |
|---|---|---|
| `TG_NOTIFICATION_DISPATCH_INTERVAL_MS` | `15000` | Outbox polling interval |
| `TG_NOTIFICATION_DISPATCH_BATCH_SIZE` | `50` | Rows taken per tick |
| `TG_NOTIFICATION_MAX_RETRIES` | `3` | Attempts per row (including the first); then `failed` |
| `TG_NOTIFICATION_PROCESSING_TIMEOUT_MS` | `600000` (10 min) | Stale `processing` rows are returned to `pending`; must exceed batch × send timeout |
| `TG_NOTIFICATION_USER_RATE_WINDOW_MS` / `TG_NOTIFICATION_USER_RATE_MAX` | 1 h / 5 | Per-user delivery budget |
| `TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS` | `300000` (5 min) | Repeat of the same critical type to the same user is suppressed |
| `TG_NOTIFICATION_DEDUPE_WINDOW_MS` | `60000` | Identical `user+type+title+body` inside the window does not create a second inbox row |
| `TG_NOTIFICATION_OUTBOX_RETENTION_MS` | 30 days | Prune `delivered`/`skipped`/`failed` outbox rows (`pending`/`processing` are never touched) |
| `TG_NOTIFICATION_INBOX_READ_RETENTION_MS` | 90 days | Prune read inbox rows |
| `TG_NOTIFICATION_INBOX_UNREAD_RETENTION_MS` | 180 days | Prune unread inbox rows |

Critical notifications (booking/trip status changes) are created regardless of
the user's `notificationsEnabled` setting; the setting affects optional types.

## Client error reporting

| Variable | Default | Purpose |
|---|---|---|
| `CLIENT_ERRORS_ENABLED` | `true` | `false`: `POST /api/v1/client-errors` still accepts and logs, but sends no Telegram alerts |
| `ERROR_ALERT_CHAT_ID` | empty | Telegram chat/group id for alerts (group ids are negative). Empty = pino log only |
| `CLIENT_ERRORS_RATE_WINDOW_MS` / `CLIENT_ERRORS_RATE_MAX` | 60 s / 10 | Per-IP throttle |

See `docs/adr/client-error-reporting.md`.

## Observability

| Variable | Default | Purpose |
|---|---|---|
| `SENTRY_DSN` | empty | Sentry for the backend (events are scrubbed of PII). Empty = helpers degrade to logs. The frontend does not use Sentry — it reports errors through `/client-errors` |
| `METRICS_TOKEN` | empty | Bearer token for `GET /metrics`. Without it, production answers `404`; outside production the endpoint is open |

## Related docs

- `README.md` — commands, deployment, API table.
- `docs/adr/telegram-notification-delivery.md` — inbox → outbox → WS.
- `docs/adr/client-error-reporting.md` — the client error channel.
