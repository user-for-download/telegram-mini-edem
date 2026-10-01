# Telegram notification parity contract

**Baseline:** [frozen VK reference](./tg-reference-baseline.md), 2026-09-09
**Decision:** [Telegram notification delivery ADR](../adr/telegram-notification-delivery.md)

## Delivery policy

The required parity channels are **persisted in-app notifications + WebSocket for foreground clients**. The inbox is authoritative; WebSocket is a low-latency hint and state-update channel. Telegram Bot API background messages are a separate **blocked** option and are not assumed below.

Each persisted notification carries a server-resolved, allowlisted `deepLink` (`Notification.deepLink`, tappable target in the inbox). Trip-related events point at the trip-details sheet `/trips/:tripId`; section events point at their section route. Values pass through `resolveTelegramDeepLink` (no query/hash/PII; unknown → `/notifications`); the client uses it directly and falls back to a type→route map when it is absent.

`notificationsEnabled=false` suppresses optional notifications only. Critical status notifications remain persisted. Until Bot API approval exists, this preference does not imply or grant consent for any external Telegram message.

## Event contract

| Event | Recipient / delivery | Opt-in and privacy | Deep-link | Retry / rate-limit | Ownership |
|---|---|---|---|---|---|
| `booking_created` | Driver: persist in inbox; WebSocket booking update + notification refresh while online. Bot API: **blocked**. | Optional toggle. Include route/seat only; no participant contact data. | `/trips/:tripId` (trip-details sheet) | Idempotent event handling; no external retry. Apply normal mutation/user limits; WebSocket reconnect resyncs. | Bookings backend; TG requests UI |
| `booking_status_changed` (`confirmed`/`declined`) | Passenger: always persist; WebSocket status + notification refresh. Bot API: **blocked**. | Critical; ignore optional toggle. Do not expose driver contact data. | `/trips/:tripId` (trip-details sheet) | Persist once per state transition; no transaction failure on delivery error. WebSocket is best effort and resyncs. | Bookings backend; TG bookings/inbox |
| `trip_cancelled` | Confirmed/pending passengers: always persist; WebSocket trip status + notification refresh. Bot API: **blocked**. | Critical; ignore optional toggle. Route is acceptable; exact meeting addresses are not. | `/trips/:tripId` (trip-details sheet) | One notification per affected user and transition; fan-out failures isolated. Reconnect/resync after disconnect. | Trips backend/admin cancellation; TG bookings/inbox |
| `trip_status_changed` (`completed`) | Passengers and driver: always persist; WebSocket trip status + notification refresh. Bot API: **blocked**. | Critical; ignore optional toggle. Review prompt is allowed; no sensitive trip details. | `/trips/:tripId` (trip-details sheet) | Worker and manual completion must be idempotent; no external retry. WebSocket reconnect/resync. | Trips backend + completion worker; TG history/inbox |
| `trip_details_changed` | Confirmed passengers: persist and WebSocket trip-details update + notification refresh. Bot API: **blocked**. | Optional toggle. Show only that details changed; user must open the app for details. | `/trips/:tripId` (trip-details sheet) | Coalesce duplicate updates per trip/user where practical; normal mutation limit. Resync authoritative trip state. | Trips backend; TG trip detail |
| `ride_request_match` | Matching passenger: persist and WebSocket refresh if online. Bot API: **blocked**. | Optional toggle; disclose only that a compatible trip exists. Existing duplicate suppression per user/trip remains required. | `/trips/:tripId` (trip-details sheet) | Deduplicate by user + trip; matching fan-out is bounded (current reference takes up to 50 requests). No external retry. | Ride-request matching backend; TG trip search/detail |
| `review_approved` | Review author: persist in inbox; WebSocket notification refresh if online. Bot API: **blocked**. | Optional toggle; no review text or moderator data in external channels. | `/reviews` | One event per moderation transition; retry only persistence/job-safe delivery. | Admin moderation + reviews/inbox UI |
| `review_rejected` | Review author: persist in inbox; WebSocket notification refresh if online. Bot API: **blocked**. | Optional toggle; do not expose internal moderation rationale unless product approves copy. | `/reviews` | One event per moderation transition; no external retry. | Admin moderation + reviews/inbox UI |
| `feedback_replied` | User: persist in inbox; WebSocket notification refresh if online. Bot API: **blocked**. | Optional toggle. Truncate/sanitize reply; avoid PII and secrets. | `/profile/support` | Persist independently of WebSocket; reconnect/resync. Normal feedback/read limits apply. | Admin support; TG support/inbox |

## Telegram deep-link format

For the required in-app channel, use authenticated app routes. For any future Bot API message, use a bot/Mini App start parameter, not a VK hash fragment:

```text
https://t.me/<approved_bot>/<approved_app>?startapp=trip_<uuid>
```

The accepted `trip_<uuid>` form is already the migration baseline. Mapping for booking history, profile, reviews and support is **blocked** until those Telegram routes exist and Product/Engineering approve canonical names. Never place raw user data, access tokens or private addresses in a start parameter.

## Inbox filtering and shared sources

- `GET /notifications/my` supports server-side filtering: `?role=driver|passenger`
  (role archives) and `?unreadOnly=1` (the "New" queue). Invalid `role` → 400.
  The client passes its segment through and never filters by type itself.
- Single sources in `@edem/contracts` (no local mirrors):
  `CRITICAL_NOTIFICATION_TYPES` (persisted regardless of the toggle),
  `NOTIFICATION_ROLE_TYPES` (type → recipient role; `trip_status_changed`
  belongs to both roles, neutral `review_*`/`feedback_*` to none — visible
  only in "New" while unread), `notificationsQuerySchema`.
- `createNotification` returns the created record id, `null` on skip
  (toggle/dedup) or failure. Callers gate the `notification:new` WS hint
  on non-null; domain WS events stay unconditional. Dedup window applies
  to all users, not only Telegram-identified ones.
- `packages/contracts/dist` is gitignored and rebuilt by CI before tests;
  the dev entrypoint (`backend` `npm run dev`) rebuilds it on every start —
  the backend resolves contracts from `dist`, a stale build silently strips
  new fields (Zod strips unknown keys) and breaks the inbox screen.

## Failure, retry and limits

- Core mutations succeed independently of notification side effects.
- Database persistence is retried only through an explicitly idempotent worker/job design; a WebSocket send is not retried as a durable delivery.
- Clients reconnect with bounded exponential backoff and jitter, then resync inbox/query state; missed WebSocket events must not be treated as lost notifications.
- Deduplicate by domain transition plus recipient (and by user + trip for matches).
- Use existing endpoint/user rate limits for inbox reads and settings. Any Bot API per-user, global, burst, retry-after and dead-letter limits are **blocked** pending approval; do not invent production values.
- Log delivery outcome without message bodies, tokens, init data, private addresses or other unnecessary PII.

## Consent and privacy

1. The in-app inbox is part of the authenticated product surface and follows existing terms/privacy consent gates.
2. The optional toggle controls non-critical in-app events; critical records remain available for operational correctness.
3. Bot API delivery requires separate explicit product/privacy approval, a documented user opt-in (if required by the approved policy), revocation, and proof that the bot chat is available for that user.
4. A Telegram username is not assumed to exist or be shareable; notification payloads must not expose it or use it as identity.

## Blocked items

- **[blocked/product]** Whether Bot API background messages are required for parity at all.
- **[blocked/product/privacy]** Bot event allowlist, copy, opt-in and revocation semantics.
- **[blocked/platform]** Bot webhook vs polling, worker deployment, token ownership/rotation, monitoring and emergency disable.
- **[blocked/platform]** Production Bot API quotas and retry-after policy; measure/confirm against the approved integration before implementation.

Canonical in-app deep links for changed-trip, review and support events are now **implemented** (see the event table and `Notification.deepLink`); only their external Bot API start-parameter form remains blocked.

These items do not block the first parity phase of in-app notifications and WebSocket behavior; they block only external Bot API delivery and its related deep links.
