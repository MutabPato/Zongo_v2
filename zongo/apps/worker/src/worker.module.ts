import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { HealthController } from './health.controller';
import { WorkerJobsModule } from './worker-jobs.module';
import { DurableJobDispatcher } from './durable-job-dispatcher.service';
import { AdminAlertDispatcher } from './admin-alert-dispatcher.service';
import { WorkerMetricsService } from './worker-metrics.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    WorkerJobsModule,
  ],
  controllers: [WorkerController, HealthController],
  providers: [
    WorkerService,
    WorkerMetricsService,
    DurableJobDispatcher,
    AdminAlertDispatcher,
  ],
})
export class WorkerModule {}
