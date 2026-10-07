-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_requestId_idx" ON "Booking"("requestId");

-- AddForeignKey
-- ON DELETE SET NULL, а не CASCADE: удаление заявки обнуляет ссылку, но НЕ
-- удаляет бронь. Бронь = реальное резервирование места в конкретной поездке,
-- поездка существует независимо от заявки, поэтому удаление заявки не имеет
-- права отменять бронь пассажира.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RideRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Комментарий-документация колонки (как у User.tgChatJoinedAt в squashed
-- init): виден в psql \d+ и при аудите схемы.
-- Nullable → бэкфилл не нужен: брони до появления потока «заявка → поездка»
-- и брони, созданные без заявки, остаются валидными с NULL.
COMMENT ON COLUMN "Booking"."requestId" IS 'Заявка пассажира, закрытая этой бронью (поток «заявка → поездка»); NULL = бронь без заявки либо создана до миграции 20261007103000.';