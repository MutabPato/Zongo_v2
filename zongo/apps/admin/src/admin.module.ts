import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { BeneficiaryModule } from '@app/beneficiary';
import { DbModule } from '@app/db';
import { ProfileModule } from '@app/profile';
import { WorkerModule } from '../../worker/src/worker.module';
import { AdminController } from './admin.controller';
import { ADMIN_ALERTS, AdminService } from './admin.service';
import { AdminAlertService } from './admin-alert.service';

@Module({
  imports: [
    DbModule,
    AuditModule,
    ProfileModule,
    BeneficiaryModule,
    WorkerModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    {
      provide: ADMIN_ALERTS,
      useExisting: AdminAlertService,
    },
    AdminAlertService,
  ],
})
export class AdminModule {}
