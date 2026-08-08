CREATE TYPE "WhatsAppIntent" AS ENUM ('START_TRANSFER', 'CONSENT', 'CANCEL', 'STATUS', 'HELP', 'UNKNOWN');
CREATE TYPE "WhatsAppLocale" AS ENUM ('EN', 'FR', 'SW', 'UNKNOWN');

ALTER TABLE "WhatsAppInboundEvent"
  ADD COLUMN "intent" "WhatsAppIntent" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "locale" "WhatsAppLocale" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "consentGiven" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WhatsAppSession"
  ADD COLUMN "locale" "WhatsAppLocale" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "consentGivenAt" TIMESTAMP(3);
