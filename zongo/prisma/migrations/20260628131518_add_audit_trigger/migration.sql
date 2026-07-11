-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('USD', 'CDF', 'KES', 'UGX');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PENDING_COLLECTION', 'COLLECTION_SUCCESS', 'COLLECTION_FAILED', 'PENDING_PAYOUT', 'PAYOUT_SUCCESS', 'PAYOUT_FAILED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('BUSINESS', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('COLLECTION', 'PAYOUT', 'STATUS_RECHECK', 'NOTIFICATION', 'RETRY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Corridor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Corridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorridorPolicy" (
    "id" TEXT NOT NULL,
    "corridorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sendCurrency" "CurrencyCode" NOT NULL,
    "payoutCurrency" "CurrencyCode" NOT NULL,
    "collectionTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "payoutTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "minSendAmountMinor" BIGINT,
    "maxSendAmountMinor" BIGINT,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorridorPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "corridorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "payoutCountryCode" TEXT NOT NULL,
    "payoutCurrency" "CurrencyCode" NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "payoutAccount" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferTransaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "corridorId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "beneficiaryId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "region" TEXT,
    "partitionKey" TEXT,
    "sendAmountMinor" BIGINT NOT NULL,
    "sendCurrency" "CurrencyCode" NOT NULL,
    "payoutAmountMinor" BIGINT,
    "payoutCurrency" "CurrencyCode",
    "partnerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "activeJobKey" TEXT,
    "collectionRequestAt" TIMESTAMP(3),
    "collectionCompletedAt" TIMESTAMP(3),
    "payoutRequestedAt" TIMESTAMP(3),
    "payoutCompletedAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "metadata" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" "AuditEventType" NOT NULL,
    "name" TEXT NOT NULL,
    "actorType" TEXT,
    "actorId" TEXT,
    "corridorId" TEXT,
    "transactionId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJob" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedJob" (
    "id" TEXT NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Corridor_code_key" ON "Corridor"("code");

-- CreateIndex
CREATE INDEX "Corridor_isActive_code_idx" ON "Corridor"("isActive", "code");

-- CreateIndex
CREATE INDEX "CorridorPolicy_corridorId_isActive_idx" ON "CorridorPolicy"("corridorId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CorridorPolicy_corridorId_version_key" ON "CorridorPolicy"("corridorId", "version");

-- CreateIndex
CREATE INDEX "Beneficiary_userId_corridorId_idx" ON "Beneficiary"("userId", "corridorId");

-- CreateIndex
CREATE INDEX "Beneficiary_corridorId_phoneNumber_idx" ON "Beneficiary"("corridorId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TransferTransaction_reference_key" ON "TransferTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "TransferTransaction_idempotencyKey_key" ON "TransferTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TransferTransaction_corridorId_createdAt_idx" ON "TransferTransaction"("corridorId", "createdAt");

-- CreateIndex
CREATE INDEX "TransferTransaction_senderUserId_status_idx" ON "TransferTransaction"("senderUserId", "status");

-- CreateIndex
CREATE INDEX "TransferTransaction_status_updatedAt_idx" ON "TransferTransaction"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_transactionId_createdAt_idx" ON "AuditEvent"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_corridorId_createdAt_idx" ON "AuditEvent"("corridorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerJob_dedupKey_key" ON "WorkerJob"("dedupKey");

-- CreateIndex
CREATE INDEX "WorkerJob_transactionReference_jobType_idx" ON "WorkerJob"("transactionReference", "jobType");

-- CreateIndex
CREATE INDEX "WorkerJob_status_createdAt_idx" ON "WorkerJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedJob_transactionReference_jobType_key" ON "ProcessedJob"("transactionReference", "jobType");

-- AddForeignKey
ALTER TABLE "CorridorPolicy" ADD CONSTRAINT "CorridorPolicy_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferTransaction" ADD CONSTRAINT "TransferTransaction_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferTransaction" ADD CONSTRAINT "TransferTransaction_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransferTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerJob" ADD CONSTRAINT "WorkerJob_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransferTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();