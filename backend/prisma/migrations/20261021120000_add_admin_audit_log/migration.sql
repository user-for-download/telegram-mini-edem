-- Admin audit trail: append-only journal of admin mutations (governance P1).
-- Rows are never updated or deleted — the API only inserts. No PII: metadata
-- carries only IDs, status transitions and counters that the admin already
-- sees behind adminGuard. actorType is "admin" (request via adminGuard) or
-- "system" (worker / background action).
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "actorType" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- Default listing: newest first.
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt" DESC);

-- Filter by action.
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt" DESC);

-- History of one entity (filter by target).
CREATE INDEX "AdminAuditLog_targetType_targetId_createdAt_idx" ON "AdminAuditLog"("targetType", "targetId", "createdAt" DESC);
