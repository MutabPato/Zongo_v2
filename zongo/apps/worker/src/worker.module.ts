import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import { WorkerJobProcessor } from './worker-job.processor';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DomainModule,
    PartnerModule,
    AuditModule,
    DbModule,
  ],
  controllers: [WorkerController, HealthController],
  providers: [WorkerService, WorkerJobProcessor],
  exports: [WorkerJobProcessor],
})
export class WorkerModule {}
