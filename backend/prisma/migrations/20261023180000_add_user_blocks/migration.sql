-- Личный чёрный список пользователей. Связь направленная (разблокировать
-- можно только свою запись), но travel-visibility запрещается при строке в
-- любую сторону. Роль не хранится: User бывает и водителем, и пассажиром.
CREATE TABLE "UserBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId"),
    CONSTRAINT "UserBlock_no_self_block" CHECK ("blockerId" <> "blockedId")
);

-- PK покрывает blockerId-first; этот индекс нужен для встречной проверки.
CREATE INDEX "UserBlock_blockedId_blockerId_idx"
ON "UserBlock"("blockedId", "blockerId");

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockerId_fkey"
FOREIGN KEY ("blockerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockedId_fkey"
FOREIGN KEY ("blockedId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
