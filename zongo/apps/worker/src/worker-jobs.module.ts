import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import { WorkerJobProcessor } from './worker-job.processor';

/**
 * Provides durable job processing without exposing the worker's HTTP
 * controllers. Operational applications import this module when they need to
 * enqueue or run a controlled retry.
 */
@Module({
  imports: [DomainModule, PartnerModule, AuditModule, DbModule],
  providers: [WorkerJobProcessor],
  exports: [WorkerJobProcessor],
})
export class WorkerJobsModule {}
