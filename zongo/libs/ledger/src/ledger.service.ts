import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import {
  LedgerAccount,
  LedgerDirection,
  CurrencyCode,
  ReconciliationStatus,
  TransactionStatus,
} from '@prisma/client';

export const LEDGER_ALERTS = Symbol('LEDGER_ALERTS');
export interface LedgerAlertPort {
  warning(name: string, details: Record<string, unknown>): Promise<void>;
  urgent(name: string, details: Record<string, unknown>): Promise<void>;
}

type LedgerFact = {
  eventName: string;
  amountMinor: bigint;
  account: LedgerAccount;
  direction: LedgerDirection;
  currency: CurrencyCode;
};

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
    const posted = await this.prisma.ledgerEntry.createMany({
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
      skipDuplicates: true,
    });
    if (posted.count === 0) return;
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
    entries: LedgerFact[],
  ) {
    const collection = entries.filter(
      (entry) => entry.eventName === 'collection',
    );
    const payout = entries.filter((entry) => entry.eventName === 'payout');
    if (
      entries.some(
        (entry) =>
          entry.eventName !== 'collection' && entry.eventName !== 'payout',
      )
    )
      return {
        status: ReconciliationStatus.MISMATCH,
        reason: 'Ledger contains an unknown lifecycle event',
      };
    const balancedPair = (
      pair: LedgerFact[],
      debitAccount: LedgerAccount,
      creditAccount: LedgerAccount,
    ) => {
      if (pair.length !== 2) return false;
      const debit = pair.find(
        (entry) =>
          entry.account === debitAccount &&
          entry.direction === LedgerDirection.DEBIT,
      );
      const credit = pair.find(
        (entry) =>
          entry.account === creditAccount &&
          entry.direction === LedgerDirection.CREDIT,
      );
      return Boolean(
        debit &&
        credit &&
        debit.amountMinor === credit.amountMinor &&
        debit.currency &&
        debit.currency === credit.currency,
      );
    };
    const collectionRequired = (
      [
        TransactionStatus.COLLECTION_SUCCESS,
        TransactionStatus.PENDING_PAYOUT,
        TransactionStatus.PAYOUT_SUCCESS,
      ] as TransactionStatus[]
    ).includes(transaction.status);
    if (collectionRequired && collection.length !== 2)
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
    if (
      (collection.length > 0 &&
        !balancedPair(
          collection,
          LedgerAccount.CUSTOMER_COLLECTION,
          LedgerAccount.PARTNER_CLEARING,
        )) ||
      (payout.length > 0 &&
        !balancedPair(
          payout,
          LedgerAccount.PARTNER_CLEARING,
          LedgerAccount.BENEFICIARY_PAYOUT,
        ))
    )
      return {
        status: ReconciliationStatus.MISMATCH,
        reason: 'Ledger entries do not match expected accounts and amounts',
      };
    return { status: ReconciliationStatus.CONSISTENT, reason: null };
  }

  async persistReconciliation(transactionId: string) {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { id: transactionId },
        include: {
          ledgerEntries: true,
          auditEvents: {
            where: { name: { startsWith: 'transfer.callback.' } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          },
        },
      },
    );
    const derived = this.deriveReconciliation(
      transaction,
      transaction.ledgerEntries,
    );
    const callbackEvents = transaction.auditEvents ?? [];
    const snapshot = await this.prisma.transactionReconciliation.upsert({
      where: { transactionId },
      create: {
        transactionId,
        ...derived,
        transactionStatus: transaction.status,
        providerStatusSnapshot: transaction.lastStatusRecheckResult,
        providerReferencePresent: Boolean(transaction.partnerReference),
        callbackCount: callbackEvents.length,
        lastCallbackAt: callbackEvents[0]?.createdAt,
      },
      update: {
        ...derived,
        transactionStatus: transaction.status,
        providerStatusSnapshot: transaction.lastStatusRecheckResult,
        providerReferencePresent: Boolean(transaction.partnerReference),
        callbackCount: callbackEvents.length,
        lastCallbackAt: callbackEvents[0]?.createdAt,
        checkedAt: new Date(),
      },
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
