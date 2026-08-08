CREATE TYPE "PilotReadinessStage" AS ENUM ('FOUNDATION_COMPLETE', 'LOCAL_E2E_COMPLETE', 'PILOT_READY');
CREATE TYPE "PilotApprovalRole" AS ENUM ('ENGINEERING', 'OPERATIONS', 'COMPLIANCE_RISK', 'RECONCILIATION', 'PILOT_OPERATOR');

CREATE TABLE "PilotReleaseRecord" (
  "id" TEXT NOT NULL DEFAULT 'pilot',
  "stage" "PilotReadinessStage" NOT NULL DEFAULT 'FOUNDATION_COMPLETE',
  "noWaiverConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "approvedCohort" JSONB,
  "numericLimits" JSONB,
  "releaseConfiguration" JSONB,
  "rollbackPlan" TEXT,
  "evidenceRefs" JSONB,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PilotReleaseRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PilotReleaseApproval" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL DEFAULT 'pilot',
  "role" "PilotApprovalRole" NOT NULL,
  "actorIdentityId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PilotReleaseApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PilotReleaseApproval_recordId_role_key"
  ON "PilotReleaseApproval"("recordId", "role");
CREATE INDEX "PilotReleaseApproval_actorIdentityId_approvedAt_idx"
  ON "PilotReleaseApproval"("actorIdentityId", "approvedAt");
ALTER TABLE "PilotReleaseApproval"
  ADD CONSTRAINT "PilotReleaseApproval_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "PilotReleaseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
