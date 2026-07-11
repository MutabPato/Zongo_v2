import { Module } from '@nestjs/common';
import { TransactionReferenceService } from './lib/transaction-reference.service';
// import { DomainService } from './domain.service';

@Module({
  providers: [TransactionReferenceService],
  exports: [TransactionReferenceService],
})
export class DomainModule {}
