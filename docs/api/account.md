# Account Deletion API

`DELETE /api/v1/users/me` requires the current user's access token and performs transactional soft deletion/anonymization.

The operation does not use the older `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` gate; it cascades instead. Future owned trips are cancelled together with their pending/confirmed bookings, without completed-trip credit. Already-departed owned trips are completed (pending bookings declined, confirmed participation kept as history). The user's pending/confirmed bookings on future active trips are cancelled and their seats released; participation after departure is preserved. Removing only the car, `DELETE /api/v1/users/me/car`, still returns `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` while the user owns an active trip.

On success, the server marks `deletedAt`, anonymizes user-facing profile data (`name`, `avatar`, `about`, `phone`) and revokes bot-notification consent (`tgChatJoinedAt`), removes the car, notifications, feedback and refresh-token rows, cancels owned RideRequests, and closes the user's WebSocket connections. Historical trips, bookings, reviews and reports remain linked to the anonymous tombstone for integrity.

The signed `telegramUserId` is retained as a tombstone so the same Telegram identity cannot silently create a second account. `/auth/telegram` and `/auth/refresh` reject deleted accounts with `403` and no tokens.

Directed `UserBlock` rows where the account is either blocker or target are deleted explicitly inside the soft-deletion transaction. Database `ON DELETE CASCADE` provides the same guarantee for a future physical cleanup.

Writes recheck the live account inside their Serializable transaction. An admitted car/profile/trip/booking write cannot restore data after deletion. Later trip completion does not recreate a deleted user's inbox or completed-trip counter.
