ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_old";

CREATE TYPE "VerificationStatus" AS ENUM (
  'PENDING',
  'TECHNICAL_REVIEW',
  'HUMAN_REVIEW',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'EXPIRED'
);

ALTER TABLE "SenderVerification"
  ALTER COLUMN "status" TYPE "VerificationStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'SUCCEEDED' THEN 'HUMAN_REVIEW'
      WHEN 'FAILED' THEN 'REJECTED'
    END
  )::"VerificationStatus";

DROP TYPE "VerificationStatus_old";

ALTER TABLE "SenderVerification"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "collectedByIdentityId" TEXT,
  ADD COLUMN "reviewerIdentityId" TEXT,
  ADD COLUMN "consentAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "SenderVerification"
SET "idempotencyKey" = 'legacy:' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "SenderVerification"
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "provider" SET DEFAULT 'OPEN_BIOMETRICS';

CREATE UNIQUE INDEX "SenderVerification_idempotencyKey_key"
  ON "SenderVerification"("idempotencyKey");
