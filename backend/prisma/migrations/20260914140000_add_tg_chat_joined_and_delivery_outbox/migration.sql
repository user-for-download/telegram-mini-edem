-- Bot API shadow mode (bot-api-approval-package §4.1):
-- 1) User.tgChatJoinedAt — факт согласия через /start в чате с ботом
--    (webhook проставляет, /stop сбрасывает в NULL).
-- 2) NotificationDelivery — outbox фоновых доставок: createNotification
--    кладёт задачу, диспетчер размечает исход (shadow: без отправки).

-- Согласие на сообщения бота.
ALTER TABLE "User" ADD COLUMN "tgChatJoinedAt" TIMESTAMP(3);

-- Outbox-таблица доставок.
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deepLink" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- Комментарий-документация согласия (для psql \d+ и аудита).
COMMENT ON COLUMN "User"."tgChatJoinedAt" IS 'Факт /start в чате с ботом (согласие на фоновые сообщения); NULL = чата нет, доставка пропускается молча. /stop сбрасывает.';

-- FK с каскадом: удаление inbox-записи убирает и её задачи доставки.
ALTER TABLE "NotificationDelivery"
    ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Индексы:
-- 1) Выборка воркером: очередь = status pending/processing + время
--    следующей попытки.
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
    ON "NotificationDelivery"("status", "nextAttemptAt");
-- 2) Per-user rate limit и дедуп по типу.
CREATE INDEX "NotificationDelivery_userId_type_idx"
    ON "NotificationDelivery"("userId", "type");
-- 3) Точечный lookup задач одной inbox-записи.
CREATE INDEX "NotificationDelivery_notificationId_idx"
    ON "NotificationDelivery"("notificationId");
