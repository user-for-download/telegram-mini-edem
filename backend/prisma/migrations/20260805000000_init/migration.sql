-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "tripsCount" INTEGER NOT NULL DEFAULT 0,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "about" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bannedAt" TIMESTAMP(3),
    "banReason" TEXT,
    "onboardingVersion" TEXT,
    "deletedAt" TIMESTAMP(3),
    "consentAcceptedAt" TIMESTAMP(3),
    "telegramUserId" BIGINT,
    "tgChatJoinedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "tripsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "plate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "fromCity" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toCity" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "price" INTEGER NOT NULL,
    "seatsTotal" INTEGER NOT NULL,
    "seatsAvailable" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fromCityId" TEXT,
    "toCityId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByType" TEXT,
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByType" TEXT,
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tripRoute" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tripId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromCityId" TEXT NOT NULL,
    "toCityId" TEXT NOT NULL,
    "earliestAt" TIMESTAMP(3) NOT NULL,
    "latestAt" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolutionNote" TEXT,
    "adminActorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "adminActorType" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE INDEX "City_name_idx" ON "City"("name");

-- CreateIndex
CREATE UNIQUE INDEX "City_nameNormalized_key" ON "City"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Car_userId_key" ON "Car"("userId");

-- CreateIndex
CREATE INDEX "Trip_status_departureAt_idx" ON "Trip"("status", "departureAt" ASC);

-- CreateIndex
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_departureAt_idx" ON "Trip"("driverId", "status", "departureAt" ASC);

-- CreateIndex
CREATE INDEX "Trip_fromCity_toCity_status_idx" ON "Trip"("fromCity", "toCity", "status");

-- CreateIndex
CREATE INDEX "Trip_fromCityId_idx" ON "Trip"("fromCityId");

-- CreateIndex
CREATE INDEX "Trip_toCityId_idx" ON "Trip"("toCityId");

-- CreateIndex
CREATE INDEX "Booking_tripId_status_idx" ON "Booking"("tripId", "status");

-- CreateIndex
CREATE INDEX "Booking_passengerId_status_idx" ON "Booking"("passengerId", "status");

-- CreateIndex
CREATE INDEX "Booking_tripId_createdAt_idx" ON "Booking"("tripId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Booking_tripId_seat_idx" ON "Booking"("tripId", "seat");

-- CreateIndex
CREATE INDEX "Booking_tripId_passengerId_idx" ON "Booking"("tripId", "passengerId");

-- CreateIndex
CREATE INDEX "Booking_status_expiresAt_idx" ON "Booking"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Review_targetUserId_createdAt_idx" ON "Review"("targetUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Review_authorId_tripId_idx" ON "Review"("authorId", "tripId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_tripId_targetUserId_key" ON "Review"("authorId", "tripId", "targetUserId");

-- CreateIndex
CREATE INDEX "Review_targetUserId_status_idx" ON "Review"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Feedback_repliedAt_idx" ON "Feedback"("repliedAt");

-- CreateIndex
CREATE INDEX "RideRequest_status_expiresAt_idx" ON "RideRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RideRequest_fromCityId_toCityId_status_earliestAt_idx" ON "RideRequest"("fromCityId", "toCityId", "status", "earliestAt");

-- CreateIndex
CREATE INDEX "RideRequest_userId_status_idx" ON "RideRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_status_idx" ON "Report"("targetType", "targetId", "status");

-- CreateIndex
CREATE INDEX "Report_reporterId_targetType_targetId_category_idx" ON "Report"("reporterId", "targetType", "targetId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_targetType_targetId_key" ON "Report"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_userId_type_idx" ON "NotificationDelivery"("userId", "type");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_fromCityId_fkey" FOREIGN KEY ("fromCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_toCityId_fkey" FOREIGN KEY ("toCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_fromCityId_fkey" FOREIGN KEY ("fromCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_toCityId_fkey" FOREIGN KEY ("toCityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_adminActorId_fkey" FOREIGN KEY ("adminActorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint: бизнес-инварианты (F1, F17), не выражаются в schema.prisma,
-- поэтому остаются raw SQL (как и в исходной истории миграций).
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_seatsTotal_range" CHECK ("seatsTotal" >= 1 AND "seatsTotal" <= 3);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_seatsAvailable_nonnegative" CHECK ("seatsAvailable" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_price_positive" CHECK ("price" > 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seat_positive" CHECK ("seat" >= 1);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);
ALTER TABLE "City" ADD CONSTRAINT "City_tripsCount_nonnegative" CHECK ("tripsCount" >= 0);

-- Partial unique indexes: Prisma не умеет выражать `where` в @@unique,
-- поэтому остаются raw SQL (как и в исходной истории миграций).

-- Одно место не может быть занято двумя активными бронями.
CREATE UNIQUE INDEX "active_seat_booking" ON "Booking"("tripId", "seat") WHERE "status" IN ('pending', 'confirmed');

-- Один пассажир = одна активная бронь на поездку.
CREATE UNIQUE INDEX "active_passenger_booking" ON "Booking"("tripId", "passengerId") WHERE "status" IN ('pending', 'confirmed');

-- NULL-safe уникальность отзыва при tripId IS NULL (F14).
CREATE UNIQUE INDEX "Review_authorId_targetUserId_nullTrip_key" ON "Review"("authorId", "targetUserId") WHERE "tripId" IS NULL;

-- Комментарий-документация согласия на сообщения бота (для psql \d+ и аудита).
COMMENT ON COLUMN "User"."tgChatJoinedAt" IS 'Факт /start в чате с ботом (согласие на фоновые сообщения); NULL = чата нет, доставка пропускается молча. /stop сбрасывает.';
