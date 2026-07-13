/* eslint-disable @typescript-eslint/unbound-method */
import { ReconciliationStatus, TransactionStatus } from '@prisma/client';
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { LedgerService, type LedgerAlertPort } from './ledger.service';

describe('LedgerService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;
  const alerts = {
    warning: jest.fn().mockResolvedValue(undefined),
    urgent: jest.fn().mockResolvedValue(undefined),
  } as unknown as LedgerAlertPort;

  it('derives reconciliation without persistence side effects', () => {
    const service = new LedgerService({} as PrismaService, audit, alerts);
    expect(
      service.deriveReconciliation(
        { status: TransactionStatus.COLLECTION_SUCCESS },
        [],
      ),
    ).toEqual({
      status: ReconciliationStatus.MISSING_COLLECTION_ENTRY,
      reason: 'Collection lifecycle requires balanced entries',
    });
    expect(
      service.deriveReconciliation(
        { status: TransactionStatus.PAYOUT_SUCCESS },
        [
          { eventName: 'collection', amountMinor: 100n },
          { eventName: 'collection', amountMinor: 100n },
          { eventName: 'payout', amountMinor: 90n },
          { eventName: 'payout', amountMinor: 100n },
        ],
      ),
    ).toEqual({
      status: ReconciliationStatus.MISMATCH,
      reason: 'Ledger debit and credit differ',
    });
  });

  it('persists a derived mismatch and emits a warning', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValue({ status: ReconciliationStatus.MISSING_PAYOUT_ENTRY });
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'tx_1',
          status: TransactionStatus.PAYOUT_SUCCESS,
          ledgerEntries: [
            { eventName: 'collection', amountMinor: 100n },
            { eventName: 'collection', amountMinor: 100n },
          ],
        }),
      },
      transactionReconciliation: { upsert },
    } as unknown as PrismaService;
    await new LedgerService(prisma, audit, alerts).persistReconciliation(
      'tx_1',
    );
    expect(upsert).toHaveBeenCalled();
    expect(alerts.warning).toHaveBeenCalledWith(
      'reconciliation.mismatch',
      expect.any(Object),
    );
  });

  it('returns the unified ops read view and emits urgent failures', async () => {
    const view = {
      reference: 'ZNG-1',
      ledgerEntries: [],
      auditEvents: [],
      reconciliation: { status: ReconciliationStatus.CONSISTENT },
    };
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(view),
      },
    } as unknown as PrismaService;
    const service = new LedgerService(prisma, audit, alerts);
    await expect(service.getOpsView('ZNG-1')).resolves.toEqual(view);
    await service.signalDirectFailure('tx_1', 'ledger write failed');
    expect(alerts.urgent).toHaveBeenCalledWith(
      'transaction-or-ledger.failure',
      { transactionId: 'tx_1', reason: 'ledger write failed' },
    );
  });
});
