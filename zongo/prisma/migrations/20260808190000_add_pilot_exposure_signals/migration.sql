CREATE TABLE "PilotExposureSignal" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "observedValue" BIGINT NOT NULL,
  "threshold" BIGINT NOT NULL,
  "lastEmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotExposureSignal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PilotExposureSignal_key_key" ON "PilotExposureSignal"("key");
