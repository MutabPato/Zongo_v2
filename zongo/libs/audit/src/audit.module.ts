import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { AUDIT_LOG_PORT } from '@app/domain';
import { AuditService } from './audit.service';

@Module({
  imports: [DbModule],
  providers: [
    AuditService,
    { provide: AUDIT_LOG_PORT, useExisting: AuditService },
  ],
  exports: [AUDIT_LOG_PORT, AuditService],
})
export class AuditModule {}
