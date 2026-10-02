# Telegram migration security & privacy audit

**Scope:** tg-migration-18. Telegram Mini App.
**Date:** 2026-09-09
**Method:** evidence-backed checklist (`.opencode/skills/security-audit`), every row
cites `file:line` actually read. No hypotheticals.
**Verdict:** no critical/high findings. Two low hardening notes (accepted risk
with owner/expiry below). One medium-adjacent test-gap fixed by new automated tests.

## 1. Auth & session — PASS

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| — | initData HMAC/TTL | `backend/src/auth/telegramSign.ts:124-126` | — | `validate()` from `@tma.js/init-data-node` with `expiresIn: TG_INIT_DATA_TTL_SECONDS` (default 3600); typed errors → 401, unknown → logged + 401 fail-closed (`:127-143`) |
| — | Exact dev-hash match | `backend/src/auth/telegramSign.ts:103` | — | `params.get("hash") !== DEV_HASH` strict `===`; comment documents why not `includes()` (`:46-49`) |
| — | Dev-bypass gates | `backend/src/auth/telegramSign.ts:101` | — | Requires `!TELEGRAM_BOT_TOKEN && ALLOW_DEV_AUTH && !isProduction`; production unreachable (`ALLOW_DEV_AUTH` forced false in prod, `env.ts:199-203`) |
| — | Route 503 when unconfigured | `backend/src/auth/index.ts:228-233` | — | No token + no dev-auth → 503 (not 401), no session churn |
| — | Tombstone before upsert | `backend/src/auth/index.ts:277-286` | — | Deleted `telegramUserId` → 403 before any mutation; re-checked post-upsert (`:331-336`) |
| — | Ban before tokens | `backend/src/auth/index.ts:315-329` | — | Active refresh family revoked, 403 with reason; no tokens issued |
| — | P2002 race retry | `backend/src/auth/index.ts:289-301` | — | Single retry on concurrent upsert race |
| — | Refresh rotation | `backend/src/auth/tokens.ts:391-393,428-433` | — | Lookup by `(tokenHash, userId)`, single-flight revoke with `revokedAt IS NULL` guard; reuse → family handling (`:279,411-417`). Covered by `refresh-rotation.test.ts` |
| — | Appeal without token | `backend/src/feedback/index.ts:135-139` | — | Banned-user appeal verifies `verifyTelegramInitData`, resolves identity by verified `telegramUserId` only; display fields ignored. Covered by `telegram-appeal.test.ts` |

**Accepted risk (low):** dev-bypass accepts an arbitrary `user.id` (no allowlist).
Contained: dev/test only, `ALLOW_DEV_AUTH=false` in
production, short-lived mock sessions (`DEV_MOCK_TOKEN_TTL_SECONDS`, `env.ts:215`).
Owner: backend. Expiry: re-review if dev-bypass ever leaves non-production.

## 2. Input validation & injection — PASS

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| — | Sanitizer coverage | `backend/src/middleware/sanitize.ts` (def); used in `auth`, `trips`, `bookings`, `reviews`, `admin`, `rideRequests`, `users`, `reports`, `feedback`, `notifications` | — | No `c.req.json()` bypass (the single grep hit in `bookings/index.ts:849-853` is a comment mandating `getSanitizedBody`) |
| — | Numeric bounds | `packages/contracts/src/dto/trip.dto.ts:33-36`, `review.dto.ts:15` | — | `durationMinutes ≤ 10080`, `distanceKm ≤ 20000`, `price ≤ 100000`, `seatsTotal ≤ 3`, review text trim+1..150 |
| — | Cursor caps | `backend/src/notifications/index.ts:35` | — | Base64 cursor length-capped (512) before decode/parse; invalid → 400 |
| — | Deep-link allowlist | `telegram-app/src/router/deepLinks.ts:20-87` | — | `trip_<uuid>` strict UUID, section allowlist, unknown → `/trips` fallback, no raw user data. Covered by `deepLinks.test.ts` |
| — | TG delivery deep-link | `backend/src/services/telegramNotifications.ts` (resolveTelegramDeepLink) | — | Rejects `? # @ whitespace`, non-UUID params, unknown → `/notifications`. Covered by unit tests |

## 3. Authorization & business invariants — PASS

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| — | Admin guard | `backend/src/admin/guard.ts:24-46` | — | Closed by default (empty `ADMIN_TOKEN` → 403 incl. login); cookie JWT verified (type/sub/exp) else 401 |
| — | Review transitions | `backend/src/reviews/index.ts` + `backend/src/admin/index.ts:1089-1109` | — | Atomic `pending → published` claim (`updateMany` count=0 → 409); participant must hold confirmed booking; duplicates → 409 via unique index incl. NULL-trip semantics |
| — | Booking/trip guards | integration suites | — | Seat race → 409 `SEAT_TAKEN` (exactly-once), stranger confirm → 403, expired → 400/409; covered by `telegram-parity.test.ts` + `telegram-trips-bookings.test.ts` |
| — | Deletion obligations | `profile-deletion.test.ts` | — | Active trip/booking → 409 `ACCOUNT_HAS_ACTIVE_OBLIGATIONS`; tombstone blocks re-login (403) |

## 4. Error handling & disclosure — PASS (one fix by this task's suite)

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| — | Notification 500 (fixed) | `backend/src/notifications/index.ts` (serialized `createdAt`) | Prisma `Date` into `z.string().datetime()` threw → 500 on any non-empty inbox | Fixed in tg-migration-16: `toISOString()` before parse; covered by `telegram-parity.test.ts` notifications leg |
| — | No secret/PII logs | `backend/src/services/telegramNotifications.ts` (deliver) | — | Log ids/codes only; bodies/tokens/initData never logged. Covered by unit test `telegramNotifications.test.ts` (“логи не содержат…”) |
| — | WS token transport | `telegram-app/src/api/ws.ts:60-77`, `WebSocketProvider.tsx:166` | — | JWT never in URL (first `auth` message); `getWsUrl` builds URL without creds; regression test asserts no token/initData/query in URL |

## 5. Rate limiting & WS — PASS with notes

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| low | IP-keyed auth limiters shared on localhost | `backend/src/middleware/rateLimit.ts:54`, `backend/src/auth/index.ts:45-49` | `TG_AUTH_RATE_MAX` 5/5min per IP: dev/E2E reruns from one host exhaust it (observed: UI shows 429 countdown, E2E logins fail). Production impact none (per-client IPs). | E2E documents the budget (one login per identity per run) + prerequisite note; consider `Retry-After` header (missing — see hardening) |
| — | Write/read/admin limiters | `backend/src/notifications/index.ts:23,76,93`, `admin/index.ts` + `rateLimit.ts:292` | — | Notification reads + read-all limited; admin reads have higher-max limiter; mutations limited |
| — | WS caps | `backend/src/ws` + `ws-limits.test.ts`, `ws-manager.test.ts` | — | Per-connection + per-IP caps, auth throttling; TG client backoff 1s→30s+jitter, single socket, 4403 terminal (task 14) |

## 6. Secrets, env & destructive ops — two low findings

| Severity | Check | File:line | What's wrong | Fix direction |
|---|---|---|---|---|
| low | ~~`.env.example` drift~~ | `.env.example` vs `backend/src/env.ts` | **ЗАКРЫТО 2026-10-01**: сверено машинно — в `backend/.env.example` не хватало 16 переменных (всё семейство `TG_NOTIFICATION_*`, `CLIENT_ERRORS_*`, `PORT`, `ERROR_ALERT_CHAT_ID`); добавлены с реальными дефолтами из `env.ts`. Пустое `TELEGRAM_DELIVERY_ENABLED=` в корневом `.env.example` заменено на `true` (совпадает с дефолтом `env.ts` и с `backend/.env.example`) | разность при пересоздании `.env` — проверять `diff <(env-uniq)`, гейта на равенство пока нет |
| low | No pino redact paths | `backend/src/logger.ts:4-17` | Safety relies on call-site discipline (currently clean — §4). One future `logger.info({ body })` leaks PII/secrets silently | Add `redact: ["*.token", "*.initData", "req.headers.authorization"]` hardening; owner: backend, no expiry pressure |
| — | Prod secrets | `backend/src/env.ts:91-109`, `docker-compose.yml:51-56` | — | `JWT_SECRET` ≥32 enforced in prod; bot token optional-with-503; compose passes through (no hardcode) |
| — | E2E cleanup | `e2e/telegram-fixtures.mjs` (cleanupRun) | — | Idempotent deletes, failure fails run; no mass-delete scripts without guards |

## Privacy (task-18 criterion 2)

- Public TG responses mask addresses from strangers (`telegram-parity.test.ts` trip leg), expose no `telegramUserId` (check serializers if extended).
- Notification payloads carry route/seat/status only; bodies logged nowhere.
- `username`/`photo_url` from initData pass host-allowlist + sanitization (`telegramProfile.ts`, referenced `auth/index.ts:246`).
- No analytics exfiltration of initData in client (initData used for `/auth/telegram` + appeal only; WS explicitly excludes it — `WebSocketProvider.test.tsx:277`).

## Follow-ups

1. `.env.example`: add TG/security subset (this task).
2. pino `redact` hardening (accepted risk, owner backend).
3. Pre-existing `user-rate-limit.test.ts` failure (fails on clean tree) — separate bug, not migration-caused.
4. Consider `Retry-After` on 429 (E2E + client backoff ergonomics).
