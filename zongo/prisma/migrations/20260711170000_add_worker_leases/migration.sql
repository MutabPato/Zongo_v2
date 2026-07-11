ALTER TABLE "WorkerJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
CREATE INDEX "WorkerJob_status_leaseExpiresAt_idx" ON "WorkerJob"("status", "leaseExpiresAt");
