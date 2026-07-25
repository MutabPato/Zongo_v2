import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { BeneficiaryModule } from '@app/beneficiary';
import { DbModule } from '@app/db';
import { ProfileModule } from '@app/profile';
import { WorkerJobsModule } from '../../worker/src/worker-jobs.module';
import { AdminController } from './admin.controller';
import { ADMIN_ALERTS, AdminService } from './admin.service';
import { AdminAlertService } from './admin-alert.service';
import { HealthController } from './health.controller';
import { WebAuthnService } from './webauthn.service';

@Module({
  imports: [
    DbModule,
    AuditModule,
    ProfileModule,
    BeneficiaryModule,
    WorkerJobsModule,
  ],
  controllers: [AdminController, HealthController],
  providers: [
    AdminService,
    {
      provide: ADMIN_ALERTS,
      useExisting: AdminAlertService,
    },
    AdminAlertService,
    WebAuthnService,
  ],
})
export class AdminModule {}
