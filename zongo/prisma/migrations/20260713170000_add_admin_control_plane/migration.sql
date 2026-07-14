CREATE TYPE "AdminRole" AS ENUM ('CUSTOMER', 'SUPPORT', 'OPS', 'ADMIN');

ALTER TABLE "TransferTransaction"
  ADD COLUMN "lastStatusRecheckAt" TIMESTAMP(3),
  ADD COLUMN "lastStatusRecheckResult" TEXT;

CREATE TABLE "PlatformIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT,
  "role" "AdminRole" NOT NULL DEFAULT 'CUSTOMER',
  "totpSecret" TEXT,
  "hardwareKeyCredentialId" TEXT,
  "mfaVerifiedAt" TIMESTAMP(3),
  "blockedAt" TIMESTAMP(3),
  "blockedReason" TEXT,
  "blockedById" TEXT,
  "breakGlassUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformIdentity_userId_key" ON "PlatformIdentity"("userId");
CREATE INDEX "PlatformIdentity_role_blockedAt_idx" ON "PlatformIdentity"("role", "blockedAt");

CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_identityId_expiresAt_idx" ON "AdminSession"("identityId", "expiresAt");

CREATE TABLE "AdminNote" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT,
  "reconciliationId" TEXT,
  "authorIdentityId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminNote_transactionId_createdAt_idx" ON "AdminNote"("transactionId", "createdAt");
CREATE INDEX "AdminNote_reconciliationId_createdAt_idx" ON "AdminNote"("reconciliationId", "createdAt");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "PlatformIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "TransferTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_reconciliationId_fkey"
  FOREIGN KEY ("reconciliationId") REFERENCES "TransactionReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_authorIdentityId_fkey"
  FOREIGN KEY ("authorIdentityId") REFERENCES "PlatformIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
