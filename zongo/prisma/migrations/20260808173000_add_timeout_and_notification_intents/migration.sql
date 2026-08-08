CREATE TYPE "NotificationIntentStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "NotificationIntent" (
  "id" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "transactionId" TEXT,
  "channel" "ContactChannel" NOT NULL,
  "recipientPhoneCiphertext" TEXT,
  "template" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "NotificationIntentStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationIntent_dedupKey_key" ON "NotificationIntent"("dedupKey");
CREATE INDEX "NotificationIntent_status_nextAttemptAt_createdAt_idx" ON "NotificationIntent"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "NotificationIntent_transactionId_createdAt_idx" ON "NotificationIntent"("transactionId", "createdAt");
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransferTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
