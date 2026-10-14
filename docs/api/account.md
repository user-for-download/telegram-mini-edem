# Account Deletion API

`DELETE /api/v1/users/me` requires the current user's access token and performs transactional soft deletion/anonymization.

The operation does not use the older `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` gate; it cascades instead. It force-completes active trips owned by the user (pending bookings declined, confirmed kept as history) and cancels the user's pending/confirmed bookings on future active trips, releasing their seats. (Removing only the car, `DELETE /api/v1/users/me/car`, still returns `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` while the user owns an active trip.)

On success, the server marks `deletedAt`, anonymizes user-facing profile data (`name`, `avatar`, `about`, `phone`) and revokes bot-notification consent (`tgChatJoinedAt`), removes the car, notifications, feedback and refresh-token rows, cancels owned RideRequests, and closes the user's WebSocket connections. Historical trips, bookings, reviews and reports remain linked to the anonymous tombstone for integrity.

The signed `telegramUserId` is retained as a tombstone so the same Telegram identity cannot silently create a second account. `/auth/telegram` and `/auth/refresh` reject deleted accounts with `403` and no tokens.
