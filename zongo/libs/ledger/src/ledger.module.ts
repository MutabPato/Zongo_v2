import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { LedgerService, LEDGER_ALERTS } from './ledger.service';

@Module({
  imports: [DbModule, AuditModule],
  providers: [
    LedgerService,
    {
      provide: LEDGER_ALERTS,
      useValue: {
        warning: () => Promise.resolve(),
        urgent: () => Promise.resolve(),
      },
    },
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
