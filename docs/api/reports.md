# Reports API

## User endpoints

- `POST /api/v1/reports` creates a report with `targetType` (`user`, `trip` or `booking`), `targetId`, `category` and `description`.
- `GET /api/v1/reports` returns only reports created by the authenticated user.

Categories are `safety`, `fraud`, `harassment`, `spam`, `inaccurate_info` and `other`.

Reports require a relevant driver/passenger relationship. Self-reports and unrelated targets are rejected. Limit is **one report forever per reporter+target**: any repeat (any category, even after resolve/reject) returns `409 CONFLICT`. Mutations are sanitized and rate-limited.

## Admin endpoints

- `GET /api/v1/admin/reports?status=&targetType=&page=&pageSize=` lists reports for an authenticated admin session.
- `GET /api/v1/admin/reports/:id` returns one report.
- `PATCH /api/v1/admin/reports/:id/status` changes status to `in_review`, `resolved` or `rejected`, optionally with `resolutionNote`.

The state machine is `pending -> in_review -> resolved|rejected`. Terminal reports cannot be changed. Admin actions record `adminActorType: "admin"` and a resolution timestamp.

One report forever is enforced by a database unique constraint on reporter, target type and target id (migration `report_one_per_reporter_target`, replacing the former partial open-report index). Concurrent duplicates return `409` via the constraint (`P2002`) as well as a pre-check. A **transient** serialization conflict (`P2034`) also returns `409`, but with `retryable: true` — distinct from the **permanent** `P2002` duplicate, so the client can safely retry the former and must not retry the latter. Admin status writes are conditional on a non-terminal current status and concurrent transitions return `409`.
