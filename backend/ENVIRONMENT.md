# Backend environment variables

## Numeric values

Explicit numeric settings must be positive safe integers. Zero, negative,
fractional, partially numeric, and out-of-range values stop startup with the
variable name instead of silently changing runtime behavior. Unset variables use
the defaults from `src/env.ts`.

This applies to `PORT`/`BACKEND_PORT`, `JWT_ACCESS_TTL_SECONDS`,
`JWT_REFRESH_TTL_SECONDS`, `ADMIN_JWT_TTL_SECONDS`, all `*_RATE_WINDOW_MS` and
`*_RATE_MAX` settings, and `TG_INIT_DATA_TTL_SECONDS`.

## Auth rate limits

Auth endpoints use independent IP-based limiters:

| Variable pair | Endpoint | Default |
|---|---|---|
| `TG_AUTH_RATE_WINDOW_MS` / `TG_AUTH_RATE_MAX` | `POST /api/v1/auth/telegram` | 5 minutes / 5 requests |
| `REFRESH_RATE_WINDOW_MS` / `REFRESH_RATE_MAX` | `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` | 10 minutes / 10 requests |
| `ADMIN_LOGIN_RATE_WINDOW_MS` / `ADMIN_LOGIN_RATE_MAX` | `POST /api/v1/admin/auth/login` | 5 minutes / 5 requests |

The former single `AUTH_RATE_WINDOW_MS`/`AUTH_RATE_MAX` pair was never wired to
the limiters and has been removed. CI sets both `*_MAX` values high so
integration tests are never throttled.

## Per-user and admin-read rate limits

High-risk authenticated routes are rate-limited per user (key = `userId`) so
changing IP/NAT cannot bypass the cap. All default to a 24-hour window. Admin
GET endpoints use a higher IP-based cap than the public read limiter because the
admin UI issues requests in batches (dashboard + lists + pagination).

| Variable pair | Endpoint | Default |
|---|---|---|
| `COMPLETE_TRIP_RATE_WINDOW_MS` / `COMPLETE_TRIP_RATE_MAX` | `PATCH /api/v1/trips/:id/complete` | 24 hours / 20 requests |
| `PROFILE_UPDATE_RATE_WINDOW_MS` / `PROFILE_UPDATE_RATE_MAX` | `PATCH /api/v1/users/me`, `POST`/`PATCH /api/v1/users/me/car` | 24 hours / 50 requests |
| `NOTIFICATION_READ_RATE_WINDOW_MS` / `NOTIFICATION_READ_RATE_MAX` | `PATCH /api/v1/notifications/:id/read`, `PATCH /api/v1/notifications/read-all` | 24 hours / 100 requests |
| `REVIEWS_READ_RATE_WINDOW_MS` / `REVIEWS_READ_RATE_MAX` | `GET /api/v1/reviews/my`, `GET /api/v1/reviews/available-trips` | 24 hours / 100 requests |
| `FEEDBACK_READ_RATE_WINDOW_MS` / `FEEDBACK_READ_RATE_MAX` | `GET /api/v1/feedback` | 24 hours / 100 requests |
| `ADMIN_READ_RATE_WINDOW_MS` / `ADMIN_READ_RATE_MAX` | all `GET` under `/api/v1/admin` | 1 minute / 300 requests |

## Admin panel

`ADMIN_TOKEN` is the static secret protecting the admin panel. It is compared
timing-safe against the body of `POST /api/v1/admin/auth/login`; a successful
login sets the httpOnly cookie `edem_admin_jwt` containing a JWT
(`type=admin-access`, `sub=admin`) signed with `JWT_SECRET`.

- Unset/empty `ADMIN_TOKEN` disables the whole admin API in every environment:
  every request under `/api/v1/admin` (including login) returns `403`. There is
  deliberately no ephemeral development fallback for this variable.
- Wrong token on login returns `401`; missing/invalid/expired session cookie on
  guarded endpoints returns `401`.
- `ADMIN_JWT_TTL_SECONDS` controls the session TTL (cookie `Max-Age` and JWT
  `exp`). Default `43200` (12 hours). There are no refresh tokens: after
  expiry the admin logs in again.
- The admin login limiter is IP-based (anti-bruteforce); in-memory buckets are
  cleared by a backend restart.
- The cookie `Secure` flag follows the request `X-Forwarded-Proto` header
  (`https` → `Secure`, `http` → no `Secure`) so login also works on HTTP-only
  admin domains behind a reverse proxy; the proxy must set/forward the header
  (`webapp/nginx.conf` does). Without the header the flag falls back to
  `isProduction`.

Example environment entries:

```dotenv
ADMIN_TOKEN=replace-with-a-long-random-secret
ADMIN_JWT_TTL_SECONDS=43200
ADMIN_LOGIN_RATE_WINDOW_MS=300000
ADMIN_LOGIN_RATE_MAX=5
```

## Telegram notification delivery

Every event is persisted to the DB first: critical ones unconditionally, optional
ones per the user's toggle, with duplicate suppression for Telegram users. The
inbox row is authoritative and is pushed over WebSocket while the app is open.

Background delivery through **Bot API is implemented and enabled by default**
(approved 2026-09-14, see `docs/adr/telegram-notification-delivery.md`): the
dispatcher (`src/workers/notificationDispatcher.ts`) sends via
`src/services/telegramSend.ts` only when the kill-switch is on, a bot token is
present and the user consented; otherwise the task settles as `skipped` with a
machine-readable reason. `src/services/telegramNotifications.ts` resolves the
deep-link (allowlisted routes) and records observability.

The outbox (`NotificationDelivery`) walks
`pending → processing → delivered | skipped | failed`. Delivery never throws:
a failure does not affect the caller's business transaction (the inbox row is
already in the DB), it is only recorded on the delivery row and logged.

### Channel switch

- `TELEGRAM_DELIVERY_ENABLED` (default `true`) is the kill-switch. When
  `false`, tasks settle as `skipped` with reason `channel_disabled` and the
  inbox record is still created. There is no `disabled` status.

### Dispatcher

| Variable | Default | Meaning |
|---|---|---|
| `TG_NOTIFICATION_DISPATCH_INTERVAL_MS` | `15000` | Dispatcher poll interval. |
| `TG_NOTIFICATION_DISPATCH_BATCH_SIZE` | `50` | Tasks claimed per poll. |
| `TG_NOTIFICATION_MAX_RETRIES` | `3` | Attempts before a task settles as `failed`. |
| `TG_NOTIFICATION_PROCESSING_TIMEOUT_MS` | `600000` (10 min) | Rows left in `processing` longer than this are requeued by the recovery pass — covers a crash between claim and settle. Must exceed batch size × per-send timeout. |
| `TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS` | `300000` (5 min) | Cooldown between repeated critical events of the same type for one user. |
| `TG_NOTIFICATION_USER_RATE_WINDOW_MS` | `3600000` (1 h) | User rate-limit window. |
| `TG_NOTIFICATION_USER_RATE_MAX` | `5` | User rate-limit budget per window. |
| `TG_NOTIFICATION_DEDUPE_WINDOW_MS` | `60000` | Dedupe window against duplicate deliveries of the same event. |

### Retention

`pruneOldNotifications` runs from the trip worker and is idempotent; a run
that finds nothing to delete is cheap, so these are safe to leave at default.

| Variable | Default | Deletes |
|---|---|---|
| `TG_NOTIFICATION_OUTBOX_RETENTION_MS` | 30 days | `NotificationDelivery` rows (outbox). |
| `TG_NOTIFICATION_INBOX_READ_RETENTION_MS` | 90 days | Read `Notification` rows. |
| `TG_NOTIFICATION_INBOX_UNREAD_RETENTION_MS` | 180 days | Unread `Notification` rows. |

### Observability

Metrics: `tg_outbox_channel_enabled`, `tg_outbox_total`, `tg_outbox_status`
(by status), `tg_outbox_skipped`, `tg_outbox_skip_policy`.
Logs use the `tg_outbox_*` family (`tg_outbox_enqueued`,
`tg_outbox_enqueue_failed`, `tg_outbox_skip_record_failed`); the dispatcher
also logs the terminal `outcome` per task. `error` on a delivery row is a
short machine code — never message text, never PII.

Example environment entries:

```dotenv
TELEGRAM_DELIVERY_ENABLED=true
TG_NOTIFICATION_DISPATCH_INTERVAL_MS=15000
TG_NOTIFICATION_MAX_RETRIES=3
TG_NOTIFICATION_PROCESSING_TIMEOUT_MS=600000
TG_NOTIFICATION_DEDUPE_WINDOW_MS=60000
TG_NOTIFICATION_OUTBOX_RETENTION_MS=2592000000
TG_NOTIFICATION_INBOX_READ_RETENTION_MS=7776000000
TG_NOTIFICATION_INBOX_UNREAD_RETENTION_MS=15552000000
```

## Metrics access

`METRICS_TOKEN` is optional in development and test. When it is unset there,
`GET /metrics` remains available for local tooling and the existing test suite.

Set `METRICS_TOKEN` to a long, randomly generated secret in production. Metrics
clients must then send it as a bearer token:

```text
Authorization: Bearer <METRICS_TOKEN>
```

If `METRICS_TOKEN` is absent in production, `GET /metrics` returns `404` instead
of exposing service metrics publicly. Missing, malformed, and incorrect bearer
credentials return `403` when a token is configured.

Example environment entry:

```dotenv
METRICS_TOKEN=replace-with-a-long-random-secret
```

## Logging and retention

The backend logs structured JSON (pino) to **stdout** — no local log files,
no in-app rotation. Log records may embed limited PII (IP in rate-limit/WS
warnings, `telegramUserId` in delivery logs, `userId` in business events).

Retention is enforced at the infrastructure level, not by the app:

- `docker-compose.yml` sets the `json-file` driver with `max-size: 10m` /
  `max-file: 3` for every service (db, backend, webapp) via the shared
  `x-logging` anchor — ~30 MB per service, oldest files are rotated away.
- The Privacy Policy (section 7) states that technical logs are kept in
  bounded volume with automatic rotation; any change here must keep that
  statement true (or update the text).

If you run the backend outside compose, configure the same bound on your
collector/systemd unit (journald `SystemMaxUse` or equivalent).
