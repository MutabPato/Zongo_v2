CREATE TYPE "PilotControlKey" AS ENUM ('GLOBAL', 'INITIATION', 'COLLECTION', 'PAYOUT', 'CORRIDOR_PROVIDER', 'NOTIFICATION');
CREATE TYPE "PilotControlState" AS ENUM ('ENABLED', 'PAUSED', 'PERMANENTLY_STOPPED');

CREATE TABLE "PilotControl" (
  "id" TEXT NOT NULL,
  "key" "PilotControlKey" NOT NULL,
  "state" "PilotControlState" NOT NULL DEFAULT 'ENABLED',
  "reason" TEXT,
  "changedByIdentityId" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotControl_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PilotControl_key_key" ON "PilotControl"("key");

CREATE TABLE "PilotAllowlist" (
  "id" TEXT NOT NULL,
  "senderProfileId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "changedByIdentityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotAllowlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PilotAllowlist_senderProfileId_key" ON "PilotAllowlist"("senderProfileId");
ALTER TABLE "PilotAllowlist" ADD CONSTRAINT "PilotAllowlist_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PilotExposurePolicy" (
  "id" TEXT NOT NULL DEFAULT 'pilot',
  "allowlistRequired" BOOLEAN NOT NULL DEFAULT true,
  "maxPendingTransfers" INTEGER,
  "maxAmbiguousTransfers" INTEGER,
  "maxPartnerSettlementMinor" BIGINT,
  "maxRecoveryCapacity" INTEGER,
  "globalDailySendMinor" BIGINT,
  "updatedByIdentityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotExposurePolicy_pkey" PRIMARY KEY ("id")
);
