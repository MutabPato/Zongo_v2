CREATE TYPE "TransferInitiationChannel" AS ENUM ('WHATSAPP', 'API', 'ADMIN');
CREATE TYPE "WhatsappSessionState" AS ENUM ('ACTIVE', 'WAITING', 'RELEASED');
ALTER TABLE "TransferTransaction" ADD COLUMN "initiationChannel" "TransferInitiationChannel" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "TransferTransaction" ADD COLUMN "whatsappChatId" TEXT;
CREATE TABLE "WhatsappSession" (
  "id" TEXT NOT NULL, "chatId" TEXT NOT NULL, "senderUserId" TEXT NOT NULL, "transactionId" TEXT NOT NULL,
  "state" "WhatsappSessionState" NOT NULL DEFAULT 'ACTIVE', "expiresAt" TIMESTAMP(3) NOT NULL,
  "waitingSince" TIMESTAMP(3), "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "WhatsappSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsappSession_chatId_key" ON "WhatsappSession"("chatId");
CREATE UNIQUE INDEX "WhatsappSession_transactionId_key" ON "WhatsappSession"("transactionId");
CREATE INDEX "WhatsappSession_state_expiresAt_idx" ON "WhatsappSession"("state", "expiresAt");
CREATE INDEX "WhatsappSession_senderUserId_state_idx" ON "WhatsappSession"("senderUserId", "state");
ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransferTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
