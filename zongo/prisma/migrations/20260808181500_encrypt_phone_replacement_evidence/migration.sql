ALTER TABLE "SenderPhoneReplacement"
  ALTER COLUMN "previousPhoneNumber" DROP NOT NULL,
  ALTER COLUMN "replacementPhoneNumber" DROP NOT NULL,
  ADD COLUMN "previousPhoneCiphertext" TEXT,
  ADD COLUMN "replacementPhoneCiphertext" TEXT,
  ADD COLUMN "previousPhoneBlindIndex" TEXT,
  ADD COLUMN "replacementPhoneBlindIndex" TEXT;

CREATE INDEX "SenderPhoneReplacement_previousPhoneBlindIndex_idx"
  ON "SenderPhoneReplacement"("previousPhoneBlindIndex");
CREATE INDEX "SenderPhoneReplacement_replacementPhoneBlindIndex_idx"
  ON "SenderPhoneReplacement"("replacementPhoneBlindIndex");
