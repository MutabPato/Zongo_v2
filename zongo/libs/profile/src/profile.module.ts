import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { SenderProfileService } from './sender-profile.service';

@Module({
  imports: [DbModule, AuditModule],
  providers: [SenderProfileService],
  exports: [SenderProfileService],
})
export class ProfileModule {}
