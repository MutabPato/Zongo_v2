ALTER TABLE "TransactionReconciliation"
  ADD COLUMN "discrepancyOwnerIdentityId" TEXT,
  ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "TransactionReconciliation_discrepancyOwnerIdentityId_idx"
  ON "TransactionReconciliation"("discrepancyOwnerIdentityId");
