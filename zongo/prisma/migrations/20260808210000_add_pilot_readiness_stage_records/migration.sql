CREATE TABLE "PilotReadinessStageRecord" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL DEFAULT 'pilot',
    "stage" "PilotReadinessStage" NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "approvedCohort" JSONB,
    "numericLimits" JSONB,
    "releaseConfiguration" JSONB,
    "rollbackPlan" TEXT,
    "noWaiverConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "recordedByIdentityId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotReadinessStageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PilotReadinessStageRecord_recordId_stage_recordedAt_idx"
ON "PilotReadinessStageRecord"("recordId", "stage", "recordedAt");

CREATE INDEX "PilotReadinessStageRecord_recordedByIdentityId_recordedAt_idx"
ON "PilotReadinessStageRecord"("recordedByIdentityId", "recordedAt");

ALTER TABLE "PilotReadinessStageRecord"
ADD CONSTRAINT "PilotReadinessStageRecord_recordId_fkey"
FOREIGN KEY ("recordId") REFERENCES "PilotReleaseRecord"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
