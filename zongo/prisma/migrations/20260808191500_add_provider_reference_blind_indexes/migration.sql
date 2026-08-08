ALTER TABLE "SenderVerification"
  ADD COLUMN "providerReferenceBlindIndex" TEXT;
ALTER TABLE "TransferTransaction"
  ADD COLUMN "partnerReferenceBlindIndex" TEXT;

CREATE INDEX "SenderVerification_providerReferenceBlindIndex_idx"
  ON "SenderVerification"("providerReferenceBlindIndex");
CREATE INDEX "TransferTransaction_partnerReferenceBlindIndex_idx"
  ON "TransferTransaction"("partnerReferenceBlindIndex");
