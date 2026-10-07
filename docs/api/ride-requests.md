# Ride Requests API

All endpoints require a user access token.

## Endpoints

- `POST /api/v1/ride-requests` creates a request with `fromCityId`, `toCityId`, `earliestAt`, `latestAt`, `expiresAt` and optional `seats`.
- `GET /api/v1/ride-requests` returns the authenticated user's requests.
- `GET /api/v1/ride-requests/matching?fromCityId=&toCityId=&earliestAt=&latestAt=` returns compatible active requests owned by other users. It never creates a booking.
- `PATCH /api/v1/ride-requests/:id` updates the time window, seats or expiry.
- `PATCH /api/v1/ride-requests/:id/status` accepts `active`, `paused`, `fulfilled` or `cancelled` according to the state machine.
- `DELETE /api/v1/ride-requests/:id` marks an owned request as `cancelled`.

At most three non-expired `active`/`paused` requests are allowed per user. Cities must be different directory entries. The backend validates ownership, dates, expiry and city existence.

Creation is performed in a serializable transaction. Concurrent quota conflicts return `409` rather than creating a fourth active request. Status, update and cancel writes use conditional ownership/status predicates and cannot resurrect a cancelled request.

Matching is informational. The passenger must open the trip and submit the normal booking request explicitly.

## Trip-scoped mirror

- `GET /api/v1/trips/:id/requests` returns active requests of other users whose route matches the trip's directory cities (`fromCityId`/`toCityId`) and whose window overlaps the trip (`earliestAt <= departureAt + durationMinutes && latestAt >= departureAt`). Only the trip's driver may read it (`403` otherwise); an unknown trip is `404`. The requester is not exposed, matching the anonymous demand feed, and the list is capped at 50 entries.

The matching predicate is shared with the notification pass that runs on trip creation (`backend/src/rideRequests/matching.ts`), so the demand a driver sees is exactly the demand passengers were notified about.

## Driver invites

- `POST /api/v1/ride-requests/:id/invite` with `{ "tripId": "<uuid>" }` lets the driver of that trip invite the author of request `:id`.

The request must still match the trip by the shared predicate (`backend/src/rideRequests/matching.ts`): active, not expired, same directory route, window overlapping the trip, not authored by the driver. Only the trip's driver may invite (`403` otherwise); an unknown trip is `404`, and a request that does not match the trip is indistinguishable from an unknown one (`404`, not `409`) so the endpoint cannot be used to probe the existence of other users' requests.

A trip with no free seats (`seatsAvailable <= 0`) is refused with `409` and **no notification is created** — the invitation would be a dead end. A trip that is not `active` is refused with `409 TRIP_NOT_ACTIVE`.

Exactly one `driver_invite` notification is created per (request, trip) pair. The pair marker lives in the notification body, so a repeated invite returns `200 { "duplicate": true }` with the original `notificationId` instead of a second inbox entry. This is deliberately not the time-windowed `findNotificationDuplicate` used elsewhere: pressing the same button twice is the same gesture, not a new event.

Response: `201 { "invited": true, "duplicate": false, "notificationId": "<uuid>" }` on creation, `200 { "invited": true, "duplicate": true, "notificationId": "<uuid>" }` on a repeat. `notificationId` is `null` when the recipient has notifications turned off.

**No booking is created** — the passenger books themself through `POST /api/v1/bookings`, so neither `Booking.source` nor `Booking.invitedById` exists. The notification carries a `deepLink` of exactly `/trips/<uuid>` (no query, hash or raw user data) plus a trip snapshot; `driver_invite` is not a critical type, so it respects the user's Telegram toggle and no separate Telegram code is needed.
