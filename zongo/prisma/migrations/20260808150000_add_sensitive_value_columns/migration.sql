ALTER TABLE "SenderProfile"
  ADD COLUMN "emailCiphertext" TEXT,
  ADD COLUMN "emailBlindIndex" TEXT,
  ADD COLUMN "senderPhoneCiphertext" TEXT,
  ADD COLUMN "senderPhoneBlindIndex" TEXT,
  ADD COLUMN "backupPhoneCiphertext" TEXT;

ALTER TABLE "Beneficiary"
  ADD COLUMN "payoutAccountCiphertext" JSONB;

CREATE UNIQUE INDEX "SenderProfile_emailBlindIndex_key"
  ON "SenderProfile"("emailBlindIndex");
CREATE UNIQUE INDEX "SenderProfile_senderPhoneBlindIndex_key"
  ON "SenderProfile"("senderPhoneBlindIndex");
