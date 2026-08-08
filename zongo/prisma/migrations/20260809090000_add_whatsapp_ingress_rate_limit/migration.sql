CREATE TABLE "WhatsAppIngressRateLimitBucket" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppIngressRateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppIngressRateLimitBucket_keyHash_key" ON "WhatsAppIngressRateLimitBucket"("keyHash");
CREATE INDEX "WhatsAppIngressRateLimitBucket_expiresAt_idx" ON "WhatsAppIngressRateLimitBucket"("expiresAt");
