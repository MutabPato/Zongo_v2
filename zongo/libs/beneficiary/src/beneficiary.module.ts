import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { SecurityModule } from '@app/security';
import { BeneficiaryService } from './beneficiary.service';

@Module({
  imports: [DbModule, AuditModule, SecurityModule],
  providers: [BeneficiaryService],
  exports: [BeneficiaryService],
})
export class BeneficiaryModule {}
