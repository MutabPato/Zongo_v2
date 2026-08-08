ALTER TABLE "WhatsAppSession"
  ALTER COLUMN "senderPhoneNumber" DROP NOT NULL,
  ADD COLUMN "senderPhoneCiphertext" TEXT,
  ADD COLUMN "senderPhoneBlindIndex" TEXT;
CREATE INDEX "WhatsAppSession_senderPhoneBlindIndex_idx" ON "WhatsAppSession"("senderPhoneBlindIndex");
