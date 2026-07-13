import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import {
  LedgerAccount,
  LedgerDirection,
  ReconciliationStatus,
  TransactionStatus,
} from '@prisma/client';

export const LEDGER_ALERTS = Symbol('LEDGER_ALERTS');
export interface LedgerAlertPort {
  warning(name: string, details: Record<string, unknown>): Promise<void>;
  urgent(name: string, details: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    @Inject(LEDGER_ALERTS) private readonly alerts: LedgerAlertPort,
  ) {}

  async appendLifecycleEntries(
    transactionId: string,
    eventName: 'collection' | 'payout',
  ): Promise<void> {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { id: transactionId } },
    );
    const amount =
      eventName === 'collection'
        ? transaction.sendAmountMinor
        : (transaction.payoutAmountMinor ?? transaction.sendAmountMinor);
    const currency =
      eventName === 'collection'
        ? transaction.sendCurrency
        : (transaction.payoutCurrency ?? transaction.sendCurrency);
    const accounts =
      eventName === 'collection'
        ? [LedgerAccount.CUSTOMER_COLLECTION, LedgerAccount.PARTNER_CLEARING]
        : [LedgerAccount.PARTNER_CLEARING, LedgerAccount.BENEFICIARY_PAYOUT];
    await this.prisma.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          account: accounts[0],
          direction: LedgerDirection.DEBIT,
          amountMinor: amount,
          currency,
          eventName,
        },
        {
          transactionId,
          account: accounts[1],
          direction: LedgerDirection.CREDIT,
          amountMinor: amount,
          currency,
          eventName,
        },
      ],
    });
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name: `ledger.${eventName}.posted`,
      transactionId,
      corridorId: transaction.corridorId,
      payload: { amountMinor: amount.toString(), currency },
      createdAt: new Date(),
    });
  }

  /** Pure comparison: it never writes a reconciliation record. */
  deriveReconciliation(
    transaction: { status: TransactionStatus },
    entries: Array<{ eventName: string; amountMinor: bigint }>,
  ) {
    const collection = entries.filter(
      (entry) => entry.eventName === 'collection',
    );
    const payout = entries.filter((entry) => entry.eventName === 'payout');
    if (
      (
        [
          TransactionStatus.COLLECTION_SUCCESS,
          TransactionStatus.PENDING_PAYOUT,
          TransactionStatus.PAYOUT_SUCCESS,
        ] as TransactionStatus[]
      ).includes(transaction.status) &&
      collection.length !== 2
    )
      return {
        status: ReconciliationStatus.MISSING_COLLECTION_ENTRY,
        reason: 'Collection lifecycle requires balanced entries',
      };
    if (
      transaction.status === TransactionStatus.PAYOUT_SUCCESS &&
      payout.length !== 2
    )
      return {
        status: ReconciliationStatus.MISSING_PAYOUT_ENTRY,
        reason: 'Payout lifecycle requires balanced entries',
      };
    for (const pair of [collection, payout])
      if (pair.length === 2 && pair[0].amountMinor !== pair[1].amountMinor)
        return {
          status: ReconciliationStatus.MISMATCH,
          reason: 'Ledger debit and credit differ',
        };
    return { status: ReconciliationStatus.CONSISTENT, reason: null };
  }

  async persistReconciliation(transactionId: string) {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { id: transactionId }, include: { ledgerEntries: true } },
    );
    const derived = this.deriveReconciliation(
      transaction,
      transaction.ledgerEntries,
    );
    const snapshot = await this.prisma.transactionReconciliation.upsert({
      where: { transactionId },
      create: { transactionId, ...derived },
      update: { ...derived, checkedAt: new Date() },
    });
    if (derived.status !== ReconciliationStatus.CONSISTENT)
      await this.alerts.warning('reconciliation.mismatch', {
        transactionId,
        status: derived.status,
      });
    return snapshot;
  }

  async getOpsView(reference: string): Promise<unknown> {
    return this.prisma.transferTransaction.findUniqueOrThrow({
      where: { reference },
      include: {
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
        auditEvents: { orderBy: { createdAt: 'asc' } },
        reconciliation: true,
      },
    });
  }

  async signalDirectFailure(
    transactionId: string,
    reason: string,
  ): Promise<void> {
    await this.alerts.urgent('transaction-or-ledger.failure', {
      transactionId,
      reason,
    });
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'TECHNICAL',
      name: 'ledger.failure.alerted',
      transactionId,
      payload: { reason },
      createdAt: new Date(),
    });
  }
}
