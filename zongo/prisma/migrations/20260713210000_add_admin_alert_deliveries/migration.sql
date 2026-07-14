ALTER TYPE "JobType" ADD VALUE 'ADMIN_ALERT';

CREATE TYPE "AdminAlertDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "AdminAlertDelivery" (
  "id" TEXT NOT NULL,
  "auditEventId" TEXT NOT NULL,
  "actionName" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "AdminAlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlertDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminAlertDelivery" ADD CONSTRAINT "AdminAlertDelivery_auditEventId_fkey"
  FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AdminAlertDelivery_status_nextAttemptAt_idx" ON "AdminAlertDelivery"("status", "nextAttemptAt");
CREATE INDEX "AdminAlertDelivery_auditEventId_idx" ON "AdminAlertDelivery"("auditEventId");
