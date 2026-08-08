ALTER TABLE "Beneficiary"
  ALTER COLUMN "phoneNumber" DROP NOT NULL;

ALTER TABLE "Beneficiary"
  ADD COLUMN "phoneNumberCiphertext" JSONB,
  ADD COLUMN "phoneNumberBlindIndex" TEXT;

CREATE INDEX "Beneficiary_corridorId_phoneNumberBlindIndex_idx"
  ON "Beneficiary"("corridorId", "phoneNumberBlindIndex");
