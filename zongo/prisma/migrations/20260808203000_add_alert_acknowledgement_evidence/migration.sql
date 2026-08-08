ALTER TABLE "AdminAlertDelivery"
  ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'URGENT',
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedByIdentityId" TEXT,
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedByIdentityId" TEXT;

CREATE INDEX "AdminAlertDelivery_acknowledgedAt_escalatedAt_idx"
  ON "AdminAlertDelivery"("acknowledgedAt", "escalatedAt");
