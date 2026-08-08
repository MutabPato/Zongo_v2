ALTER TABLE "WhatsAppInboundEvent"
  ALTER COLUMN "senderPhoneNumber" DROP NOT NULL,
  ADD COLUMN "senderPhoneCiphertext" TEXT,
  ADD COLUMN "senderPhoneBlindIndex" TEXT;

CREATE INDEX "WhatsAppInboundEvent_senderPhoneBlindIndex_idx"
  ON "WhatsAppInboundEvent"("senderPhoneBlindIndex");
