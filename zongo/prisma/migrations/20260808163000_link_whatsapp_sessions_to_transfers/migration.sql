ALTER TABLE "WhatsAppSession" ADD COLUMN "transferId" TEXT;
CREATE UNIQUE INDEX "WhatsAppSession_transferId_key" ON "WhatsAppSession"("transferId");
