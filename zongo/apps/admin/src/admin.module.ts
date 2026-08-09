import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { BeneficiaryModule } from '@app/beneficiary';
import { DbModule } from '@app/db';
import { ProfileModule } from '@app/profile';
import { SecurityModule } from '@app/security';
import { WorkerJobsModule } from '../../worker/src/worker-jobs.module';
import { AdminController } from './admin.controller';
import { AdminV1Controller } from './admin-v1.controller';
import { ADMIN_ALERTS, AdminService } from './admin.service';
import { AdminAlertService } from './admin-alert.service';
import { HealthController } from './health.controller';
import { WebAuthnService } from './webauthn.service';
import { LegacyAdminCompatibilityInterceptor } from './legacy-admin-compatibility.interceptor';

@Module({
  imports: [
    DbModule,
    AuditModule,
    ProfileModule,
    BeneficiaryModule,
    WorkerJobsModule,
    SecurityModule,
  ],
  controllers: [AdminController, AdminV1Controller, HealthController],
  providers: [
    AdminService,
    {
      provide: ADMIN_ALERTS,
      useExisting: AdminAlertService,
    },
    AdminAlertService,
    WebAuthnService,
    LegacyAdminCompatibilityInterceptor,
  ],
})
export class AdminModule {}
