-- AlterTable
-- Два булевых флага — решения владельца при создании поездки.
--
-- Миграция безопасна и на чистой БД, и на БД с существующими поездками:
-- Postgres (< 11 — вообще, 11+ без volatile-выражений) применяет DEFAULT
-- к уже существующим строкам при ADD COLUMN ... NOT NULL DEFAULT, поэтому
-- ручной бэкфилл и, тем более, --accept-data-loss не нужны.
--
-- Дефолты НАМЕРЕННО сохраняют текущее поведение (см. комментарий в
-- schema.prisma): все поездки, созданные до этой миграции, получают
-- autoComplete = false (автозавершение по старому TTL) и
-- matchingEnabled = true (безусловный подбор ride request'ов).
ALTER TABLE "Trip" ADD COLUMN     "autoComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Trip" ADD COLUMN     "matchingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Комментарий-документация колонки (как у Booking.requestId и
-- User.tgChatJoinedAt): виден в psql \d+ и при аудите схемы.
COMMENT ON COLUMN "Trip"."autoComplete" IS 'Завершать поездку автоматически сразу по окончании рейса (вместо текущего TTL +24ч). false = прежнее поведение: поездка протухает через PENDING_BOOKING_TTL_MS после отъезда.';
COMMENT ON COLUMN "Trip"."matchingEnabled" IS 'Предлагать подходящие ride request''ы (уведомления, карточка спроса, WS-хинт). true = прежнее поведение: безусловный подбор. Выключает только владелец при создании поездки.';