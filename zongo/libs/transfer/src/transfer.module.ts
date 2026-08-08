import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { SecurityModule } from '@app/security';
import { TransferInitiationService } from './transfer-initiation.service';

@Module({
  imports: [DbModule, AuditModule, DomainModule, SecurityModule],
  providers: [TransferInitiationService],
  exports: [TransferInitiationService],
})
export class TransferModule {}
