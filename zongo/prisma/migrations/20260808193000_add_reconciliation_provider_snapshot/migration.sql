ALTER TABLE "TransactionReconciliation"
  ADD COLUMN "transactionStatus" "TransactionStatus",
  ADD COLUMN "providerStatusSnapshot" TEXT,
  ADD COLUMN "providerReferencePresent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "callbackCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastCallbackAt" TIMESTAMP(3);
