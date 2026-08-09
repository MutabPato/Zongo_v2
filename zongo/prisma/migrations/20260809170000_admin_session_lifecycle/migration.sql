ALTER TABLE "AdminSession"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'TOTP';

DROP INDEX IF EXISTS "AdminSession_identityId_expiresAt_idx";
CREATE INDEX "AdminSession_identityId_expiresAt_revokedAt_idx"
  ON "AdminSession"("identityId", "expiresAt", "revokedAt");
