CREATE TYPE "KycTier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'MOBILE_APP');

CREATE TABLE "SenderProfile" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "legalName" TEXT, "email" TEXT,
  "senderPhoneNumber" TEXT, "whatsappPhoneNumber" TEXT NOT NULL, "backupPhoneNumber" TEXT,
  "tier" "KycTier" NOT NULL DEFAULT 'TIER_0', "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SenderProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SenderProfile_userId_key" ON "SenderProfile"("userId");
CREATE UNIQUE INDEX "SenderProfile_email_key" ON "SenderProfile"("email");
CREATE UNIQUE INDEX "SenderProfile_senderPhoneNumber_key" ON "SenderProfile"("senderPhoneNumber");
CREATE INDEX "SenderProfile_senderPhoneNumber_idx" ON "SenderProfile"("senderPhoneNumber");
CREATE INDEX "SenderProfile_tier_createdAt_idx" ON "SenderProfile"("tier", "createdAt");

CREATE TABLE "SenderVerification" (
  "id" TEXT NOT NULL, "senderProfileId" TEXT NOT NULL, "provider" TEXT NOT NULL DEFAULT 'SMILE_ID',
  "providerReference" TEXT NOT NULL, "status" "VerificationStatus" NOT NULL, "verifiedPhoneNumber" TEXT,
  "failureReason" TEXT, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SenderVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SenderVerification_providerReference_key" ON "SenderVerification"("providerReference");
CREATE INDEX "SenderVerification_senderProfileId_createdAt_idx" ON "SenderVerification"("senderProfileId", "createdAt");
CREATE INDEX "SenderVerification_status_createdAt_idx" ON "SenderVerification"("status", "createdAt");

CREATE TABLE "SenderPhoneReplacement" (
  "id" TEXT NOT NULL, "senderProfileId" TEXT NOT NULL, "previousPhoneNumber" TEXT NOT NULL,
  "replacementPhoneNumber" TEXT NOT NULL, "verificationId" TEXT NOT NULL,
  "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SenderPhoneReplacement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SenderPhoneReplacement_verificationId_key" ON "SenderPhoneReplacement"("verificationId");
CREATE INDEX "SenderPhoneReplacement_senderProfileId_replacedAt_idx" ON "SenderPhoneReplacement"("senderProfileId", "replacedAt");

CREATE TABLE "TierLimitPolicy" (
  "id" TEXT NOT NULL, "tier" "KycTier" NOT NULL, "perTransferLimitMinor" BIGINT NOT NULL,
  "dailyLimitMinor" BIGINT NOT NULL, "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TierLimitPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TierLimitPolicy_tier_key" ON "TierLimitPolicy"("tier");

CREATE TABLE "SenderTierLimitOverride" (
  "id" TEXT NOT NULL, "senderProfileId" TEXT NOT NULL, "perTransferLimitMinor" BIGINT,
  "dailyLimitMinor" BIGINT, "reason" TEXT NOT NULL, "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SenderTierLimitOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SenderTierLimitOverride_senderProfileId_key" ON "SenderTierLimitOverride"("senderProfileId");

CREATE TABLE "ContactPreference" (
  "id" TEXT NOT NULL, "senderProfileId" TEXT NOT NULL, "preferredChannel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
  "preferredLanguage" TEXT NOT NULL DEFAULT 'en', "notificationsOptedIn" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactPreference_senderProfileId_key" ON "ContactPreference"("senderProfileId");

CREATE TABLE "ChannelMigration" (
  "id" TEXT NOT NULL, "senderProfileId" TEXT NOT NULL, "fromChannel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
  "toChannel" "ContactChannel" NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "externalReference" TEXT,
  "migratedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelMigration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChannelMigration_senderProfileId_createdAt_idx" ON "ChannelMigration"("senderProfileId", "createdAt");

ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SenderPhoneReplacement" ADD CONSTRAINT "SenderPhoneReplacement_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SenderTierLimitOverride" ADD CONSTRAINT "SenderTierLimitOverride_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactPreference" ADD CONSTRAINT "ContactPreference_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelMigration" ADD CONSTRAINT "ChannelMigration_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "SenderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
