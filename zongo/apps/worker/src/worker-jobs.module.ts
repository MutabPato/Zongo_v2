import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import { LedgerModule } from '@app/ledger';
import { SecurityModule } from '@app/security';
import { WhatsAppModule } from '@app/whatsapp';
import { WorkerJobProcessor } from './worker-job.processor';
import { PilotExposureMonitor } from './pilot-exposure-monitor.service';

/**
 * Provides durable job processing without exposing the worker's HTTP
 * controllers. Operational applications import this module when they need to
 * enqueue or run a controlled retry.
 */
@Module({
  imports: [
    DomainModule,
    PartnerModule,
    AuditModule,
    DbModule,
    LedgerModule,
    SecurityModule,
    WhatsAppModule,
  ],
  providers: [WorkerJobProcessor, PilotExposureMonitor],
  exports: [WorkerJobProcessor, PilotExposureMonitor],
})
export class WorkerJobsModule {}
