# ADR: Telegram notification delivery

**Status:** Accepted; Bot API option **approved for implementation** (2026-09-14, see below)
**Date:** 2026-09-09 (parity phase), 2026-09-14 (Bot API approval)
**Scope:** Telegram Mini App migration from the frozen VK reference

## Decision

Implement notification parity in this order:

1. **In-app notification inbox** backed by the existing notification records and preference semantics.
2. **WebSocket delivery** for foreground updates, query invalidation and unread-count refresh.
3. Validate parity and operational behavior in Telegram.
4. Treat **background messages through Telegram Bot API as a separate product option**. Do not build, enable, or promise them without explicit product approval.

The first two channels are the functional-parity baseline. A closed app must still show persisted critical notifications when the user next opens it; background delivery is not assumed to be required for parity.

## Frozen reference and mapping

The VK reference has:

- persisted notifications with critical status events created even when optional notifications are disabled;
- WebSocket events for booking/trip changes and `notification:new` refreshes;
- VK-only push/message integrations for selected events.

Telegram mapping:

| Reference behavior | Telegram decision |
|---|---|
| Notification inbox | Required: implement the Telegram route, list, unread count, mark-read and mark-all-read. |
| Foreground VK WebSocket behavior | Required: port auth, ping/pong, reconnect, refresh/resync and event handling. |
| `notifications.sendMessage` / `messages.send` | Not a literal port. Bot API delivery is **blocked** pending product approval. |

## Contract rules

- Critical events (`booking_status_changed`, `trip_cancelled`, `trip_status_changed`) are persisted regardless of the shared optional-notification toggle.
- Optional events follow the user preference and must not leak content through an unapproved external channel.
- WebSocket is best effort: reconnect and resync from the inbox; it is never the source of truth.
- Every notification has a stable event type, safe user-scoped payload, and a Telegram deep-link target defined in [`../migration/notification-parity-contract.md`](../migration/notification-parity-contract.md).
- Delivery failure must not roll back booking, trip, review or support operations.

## Bot API option — approved (2026-09-14)

**Originally blocked; approved by Product on 2026-09-14** with the decisions
recorded in [`../product/bot-api-approval-package.md`](../product/bot-api-approval-package.md) §6а:

- Event allowlist (9 events) and message copy — approved as drafted.
- Consent: bot never messages first; `/start` (webhook) records consent,
  `/stop` or admin stop revokes it immediately. No chat → quiet skip,
  critical included.
- Single shared notifications toggle (no separate Telegram flag).
- Message body = notification title + body (cities/dates only, verified
  against call sites); deep-link allowlist via `resolveTelegramDeepLink`.
- Rollout: 100% at once (app in development, no real users); kill-switch
  `TELEGRAM_DELIVERY_ENABLED=false` remains the instant global off.
- Spam-complaint SLA: 24 hours; per-user stop via
  `PATCH /admin/users/:id/telegram-stop`.

Engineering constraints for the enabled channel:

- Outbox pattern (`NotificationDelivery`) is the source of truth for
  delivery state; the dispatcher re-reads the kill-switch, user consent
  and toggle on every tick (no caching).
- `TELEGRAM_BOT_TOKEN` presence gates real sending: without a token the
  dispatcher stays in shadow mode (`delivered` + `error='shadow'`).
- Rate limits: optional ≤5/hour per user, critical ≤1 per 5 min per type;
  retries with 1m/5m/15m backoff, max 3 attempts.
- Telegram 403 (bot blocked) → skip as `bot_blocked` and clear
  `tgChatJoinedAt` (consent is effectively revoked).
- No Bot API background message outside this outbox path; the previous
  rule ("no production messaging worker ... implied by this ADR") is
  lifted strictly for this dispatcher.

## Ownership

| Area | Owner | Gate |
|---|---|---|
| In-app records, preferences, WebSocket and resync | Backend + Telegram client | Engineering; parity acceptance |
| Event copy, critical/optional classification and Bot API approval | Product | Approved 2026-09-14 |
| Privacy/consent and data minimization | Product + Security/Privacy | Approved with package (§3) |
| Bot token, webhook or polling runtime, secret rotation and alerting | Platform/Backend on-call | Runbook: kill-switch + admin stop shipped |
| Deep-link routes and start-parameter handling | Telegram client + Backend | Required for every delivered event |

## Consequences

Positive: parity is achievable without coupling core transactions to Telegram messaging, and users can recover missed foreground events from the inbox.
Trade-off: users do not receive an external message while the app is closed unless the separate Bot API option is approved and implemented.

## Acceptance checks

- Telegram can open the inbox, show unread count, paginate, mark one read and mark all read.
- Critical notifications exist with the optional toggle off.
- WebSocket reconnect/resync restores missed notification and booking/trip state.
- Background Bot API messages flow only through the approved outbox dispatcher
  (`notificationDispatcher.ts`) with consent, rate limits and kill-switch
  enforced per tick; shadow mode (no token) marks `delivered`/`shadow` without
  any external call.
