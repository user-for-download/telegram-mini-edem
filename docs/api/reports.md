# Reports API

## User endpoints

- `POST /api/v1/reports` creates a report with `targetType` (`user`, `trip` or `booking`), `targetId`, `category` and `description`.
- `GET /api/v1/reports` returns only reports created by the authenticated user.
- `GET /api/v1/reports/targets` returns the objects the authenticated user may report on: trips they booked as a passenger, bookings where they are the passenger or the driver, and the counterpart people in those bookings. It reads the 50 most recent bookings and deduplicates. Each entry carries the raw fields the UI needs for a label (`fromCity`/`toCity`/`departureAt` for trips and bookings, `name` for people); dates are formatted client-side. The list follows the same rules as `canReport` (including the reporting window), so every listed target is accepted by `POST`.

Categories are `safety`, `fraud`, `harassment`, `spam`, `inaccurate_info` and `other`.

Reports require a relevant driver/passenger relationship **and a trip inside the reporting window**: the trip must have started and at most **7 days** may have passed since it ended (`departureAt + durationMinutes`). Not-yet-started and older trips are rejected with `403`, and `GET /reports/targets` omits them. Self-reports and unrelated targets are rejected. Limit is **one report forever per reporter+target**: any repeat (any category, even after resolve/reject) returns `409 CONFLICT`. Mutations are sanitized and rate-limited.

## Admin endpoints

- `GET /api/v1/admin/reports?status=&targetType=&page=&pageSize=` lists reports for an authenticated admin session. Response is `{ items, total, page, pageSize }` (no `pagination` envelope).
- `GET /api/v1/admin/reports/:id` returns one report; `404` for an unknown id.
- `PATCH /api/v1/admin/reports/:id/status` changes status to `in_review`, `resolved` or `rejected`, optionally with `resolutionNote`.

Each admin report item carries `targetLabel` (always-present fallback:
`Пользователь`/`Поездка`/`Бронь`) and `targetSummary` (nullable):
`{ id, targetType, label, secondary, userId, tripId, bookingId }`.
`label` is the user name, `Москва → Тула` or `Бронь: место 2`; navigation ids
are populated only for the relevant target type. Summaries are resolved in
batched queries, not one query per row.

The state machine is `pending -> in_review -> resolved|rejected`. Terminal reports cannot be changed. Admin actions record `adminActorType: "admin"` and a resolution timestamp, and write one `AdminAuditLog` row with `action: "report.status"` and `metadata: { from, to }` in the same transaction.

One report forever is enforced by a database unique constraint on reporter, target type and target id (migration `report_one_per_reporter_target`, replacing the former partial open-report index). Concurrent duplicates return `409` via the constraint (`P2002`) as well as a pre-check. A **transient** serialization conflict (`P2034`) also returns `409`, but with `retryable: true` — distinct from the **permanent** `P2002` duplicate, so the client can safely retry the former and must not retry the latter. Admin status writes are conditional on a non-terminal current status and concurrent transitions return `409`.
