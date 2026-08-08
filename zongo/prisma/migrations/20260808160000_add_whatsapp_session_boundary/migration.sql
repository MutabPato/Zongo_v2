CREATE TYPE "WhatsAppSessionStatus" AS ENUM ('ACTIVE', 'WAITING', 'CLOSED');

CREATE TABLE "WhatsAppSession" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "senderPhoneNumber" TEXT NOT NULL,
  "status" "WhatsAppSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "activeChatKey" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppSession_activeChatKey_key" ON "WhatsAppSession"("activeChatKey");
CREATE INDEX "WhatsAppSession_chatId_status_updatedAt_idx" ON "WhatsAppSession"("chatId", "status", "updatedAt");

CREATE TABLE "WhatsAppInboundEvent" (
  "id" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "senderPhoneNumber" TEXT NOT NULL,
  "payloadRedacted" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppInboundEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppInboundEvent_externalEventId_key" ON "WhatsAppInboundEvent"("externalEventId");
CREATE INDEX "WhatsAppInboundEvent_chatId_receivedAt_idx" ON "WhatsAppInboundEvent"("chatId", "receivedAt");
