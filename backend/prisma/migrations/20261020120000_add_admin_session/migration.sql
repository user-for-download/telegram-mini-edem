-- Admin session revocation: stateless admin JWT alone cannot be logged out
-- before exp. Store jti + fingerprint of the current ADMIN_TOKEN so logout
-- and ADMIN_TOKEN rotation invalidate sessions immediately.
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "adminTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminSession_jti_key" ON "AdminSession"("jti");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
