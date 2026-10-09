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

## Opting out: `matchingEnabled = false`

A trip created with `matchingEnabled: false` is not offered to anyone: **no** `ride_request_match` notification is created when the trip is created.

This is now the **only** surface of the switch — there is no driver-side demand screen to gate. The client learns the state from the trip payload (`matchingEnabled` in `tripSchema`, required and without a default — an unknown value is not "off"), and the trips screen shows an explicit note next to the trip, because "nobody was notified" and "nobody is looking" must not look alike.

The option is editable later through `PATCH /api/v1/trips/:id`; the gate reads the flag at notification time, so switching it off takes effect immediately.

**The trip is not hidden from search.** `GET /api/v1/trips` is unaffected — passengers still find it and can book it themselves. Opting out suppresses *automatic suggestions*, not availability.


