import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { SecurityModule } from '@app/security';
import { SenderProfileService } from './sender-profile.service';

@Module({
  imports: [DbModule, AuditModule, SecurityModule],
  providers: [SenderProfileService],
  exports: [SenderProfileService],
})
export class ProfileModule {}
