/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { JobStatus, TransactionStatus } from '@prisma/client';
import type { AuditLogPort, PartnerPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import type { LedgerService } from '@app/ledger';
import { WorkerJobProcessor } from './worker-job.processor';

describe('WorkerJobProcessor', () => {
  const noopLedger = {
    appendLifecycleEntries: jest.fn().mockResolvedValue(undefined),
    persistReconciliation: jest
      .fn()
      .mockResolvedValue({ status: 'CONSISTENT' }),
  } as unknown as LedgerService;
  const job = {
    transactionReference: 'ZNG-TEST-001',
    jobType: 'COLLECTION' as const,
    payload: {},
  };
  const transaction = {
    id: 'tx_1',
    reference: job.transactionReference,
    beneficiaryId: 'ben_1',
    sendAmountMinor: 100n,
    sendCurrency: 'USD',
    corridorId: 'corr_1',
    status: TransactionStatus.PENDING_COLLECTION,
  };

  it('does not execute a job that another worker holds', async () => {
    const partner = {
      collect: jest.fn(),
      payout: jest.fn(),
      status: jest.fn(),
    } as unknown as PartnerPort;
    const audit = { append: jest.fn() } as unknown as AuditLogPort;
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    await expect(
      new WorkerJobProcessor(prisma, partner, audit, noopLedger).process(job),
    ).resolves.toEqual({ skipped: true, reason: 'already-claimed' });
    expect(partner.collect).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('sends a notification intent without changing transfer lifecycle state', async () => {
    const workerUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_notification_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: workerUpdate,
      },
      notificationIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'intent_1',
          recipientPhoneCiphertext: JSON.stringify({ ciphertext: 'phone' }),
          template: 'transfer.resolved',
          payload: { status: 'PAYOUT_SUCCESS' },
          attempts: 0,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrismaService;
    const notifier = { send: jest.fn().mockResolvedValue(undefined) };
    const protection = {
      decrypt: jest.fn().mockResolvedValue('+243800000001'),
    };
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
      notifier,
      protection as never,
    );

    await expect(
      processor.process({
        transactionReference: 'intent_1',
        jobType: 'NOTIFICATION',
        payload: { notificationIntentId: 'intent_1' },
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    expect(notifier.send).toHaveBeenCalledWith({
      recipientPhoneNumber: '+243800000001',
      template: 'transfer.resolved',
      payload: { status: 'PAYOUT_SUCCESS' },
    });
    expect(workerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });

  it('does not call a partner while the matching money-movement control is paused', async () => {
    const partner = {
      collect: jest.fn(),
      payout: jest.fn(),
      status: jest.fn(),
    } as unknown as PartnerPort;
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_paused' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      pilotControl: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ key: 'COLLECTION', state: 'PAUSED' }]),
      },
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      partner,
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'FAILED',
    });
    expect(partner.collect).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: JobStatus.PENDING }),
      }),
    );
  });

  it('records failure and permits a later retry to succeed', async () => {
    const partner: PartnerPort = {
      collect: jest
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: {
            message: 'temporary outage',
            code: 'PARTNER_TEMPORARY_FAILURE',
            retryable: true,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          partnerReference: 'partner_1',
        }),
      payout: jest.fn(),
      status: jest.fn(),
    };
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
        update: jest.fn().mockReturnValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const processor = new WorkerJobProcessor(
      prisma,
      partner,
      audit,
      noopLedger,
    );

    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'FAILED',
    });
    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'SUCCEEDED',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          lastError: 'temporary outage',
        }),
      }),
    );
    expect(partner.collect).toHaveBeenCalledTimes(2);
    expect(partner.collect).toHaveBeenLastCalledWith({
      reference: job.transactionReference,
      amountMinor: 100n,
      currency: 'USD',
      beneficiaryId: 'ben_1',
    });
  });

  it('keeps a transfer pending when a collection failure is retryable', async () => {
    const transferUpdate = jest.fn().mockReturnValue({});
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockReturnValue({}),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PENDING_COLLECTION,
        }),
        update: transferUpdate,
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      {
        collect: jest.fn().mockResolvedValue({
          success: false,
          error: {
            message: 'temporary outage',
            code: 'PARTNER_TEMPORARY_FAILURE',
            retryable: true,
          },
        }),
        payout: jest.fn(),
        status: jest.fn(),
      },
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'FAILED',
    });
    expect(transferUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TransactionStatus.COLLECTION_FAILED,
        }),
      }),
    );
  });

  it('prepares a manual payout retry on the original reference without refunding', async () => {
    const failedTransaction = {
      ...transaction,
      status: TransactionStatus.PAYOUT_FAILED,
      retryBeneficiaryId: null,
    };
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({ id: 'manual_job_1' });
    const databaseTransaction = jest.fn(
      async (operation: (client: unknown) => Promise<unknown>) =>
        operation({
          transferTransaction: { updateMany: update },
          workerJob: { create },
        }),
    );
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(failedTransaction),
        update,
      },
      workerJob: { create },
      $transaction: databaseTransaction,
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(
      processor.prepareManualPayoutRetry(
        transaction.reference,
        'ben_corrected',
      ),
    ).resolves.toEqual({
      transactionReference: transaction.reference,
      jobType: 'PAYOUT',
      payload: { manual: true },
      persistedJobId: 'manual_job_1',
    });
    expect(update).toHaveBeenCalledWith({
      where: {
        id: transaction.id,
        status: TransactionStatus.PAYOUT_FAILED,
      },
      data: expect.objectContaining({
        status: TransactionStatus.PENDING_PAYOUT,
        retryBeneficiaryId: 'ben_corrected',
      }),
    });
    expect(databaseTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not create two manual payout retries for the same failed state', async () => {
    const create = jest.fn();
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PAYOUT_FAILED,
          retryBeneficiaryId: null,
        }),
      },
      $transaction: jest.fn(
        async (operation: (client: unknown) => Promise<unknown>) =>
          operation({
            transferTransaction: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            workerJob: { create },
          }),
      ),
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(
      processor.prepareManualPayoutRetry(transaction.reference),
    ).rejects.toThrow('already been prepared');
    expect(create).not.toHaveBeenCalled();
  });

  it('pays the beneficiary using payout money rather than send money', async () => {
    const payout = jest
      .fn()
      .mockResolvedValue({ success: true, partnerReference: 'partner_2' });
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_2' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockReturnValue({}),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PENDING_PAYOUT,
          payoutAmountMinor: 12_900n,
          payoutCurrency: 'KES',
        }),
        update: jest.fn().mockReturnValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const ledger = {
      appendLifecycleEntries: jest.fn().mockResolvedValue(undefined),
      persistReconciliation: jest
        .fn()
        .mockResolvedValue({ status: 'CONSISTENT' }),
    } as unknown as LedgerService;
    const processor = new WorkerJobProcessor(
      prisma,
      { collect: jest.fn(), payout, status: jest.fn() },
      { append: jest.fn().mockResolvedValue(undefined) },
      ledger,
    );

    await expect(
      processor.process({ ...job, jobType: 'PAYOUT' }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    expect(payout).toHaveBeenCalledWith({
      reference: transaction.reference,
      amountMinor: 12_900n,
      currency: 'KES',
      beneficiaryId: transaction.beneficiaryId,
    });
    expect(ledger.appendLifecycleEntries).toHaveBeenCalledWith(
      transaction.id,
      'payout',
    );
    expect(ledger.persistReconciliation).toHaveBeenCalledWith(transaction.id);
  });

  it('does not execute payout before the transfer enters pending payout', async () => {
    const payout = jest.fn();
    const transferUpdate = jest.fn().mockReturnValue({});
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_2' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.INITIATED,
          payoutAmountMinor: 12_900n,
          payoutCurrency: 'KES',
        }),
        findUnique: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.INITIATED,
        }),
        update: transferUpdate,
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      { collect: jest.fn(), payout, status: jest.fn() },
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(
      processor.process({ ...job, jobType: 'PAYOUT' }),
    ).resolves.toEqual({ skipped: false, status: 'FAILED' });
    expect(payout).not.toHaveBeenCalled();
    expect(transferUpdate).not.toHaveBeenCalled();
  });

  it('records a late callback as audit-only without changing a closed transfer', async () => {
    const closedTransaction = {
      ...transaction,
      status: TransactionStatus.PAYOUT_FAILED,
    };
    const update = jest.fn();
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(closedTransaction),
        update,
      },
    } as unknown as PrismaService;
    const auditAppend = jest.fn().mockResolvedValue(undefined);
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: auditAppend },
      noopLedger,
    );

    await expect(
      processor.handlePartnerCallback(
        transaction.reference,
        TransactionStatus.PAYOUT_SUCCESS,
        'partner_late',
      ),
    ).resolves.toEqual({ applied: false });
    expect(update).not.toHaveBeenCalled();
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'transfer.callback.late' }),
    );
  });

  it('posts and reconciles ledger entries for a valid success callback', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PENDING_PAYOUT,
        }),
        update,
      },
    } as unknown as PrismaService;
    const ledger = {
      appendLifecycleEntries: jest.fn().mockResolvedValue(undefined),
      persistReconciliation: jest
        .fn()
        .mockResolvedValue({ status: 'CONSISTENT' }),
    } as unknown as LedgerService;
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: jest.fn().mockResolvedValue(undefined) },
      ledger,
    );

    await expect(
      processor.handlePartnerCallback(
        transaction.reference,
        TransactionStatus.PAYOUT_SUCCESS,
        'partner_success',
      ),
    ).resolves.toEqual({ applied: true });
    expect(ledger.appendLifecycleEntries).toHaveBeenCalledWith(
      transaction.id,
      'payout',
    );
    expect(ledger.persistReconciliation).toHaveBeenCalledWith(transaction.id);
  });

  it('treats an identical callback delivery as an idempotent no-op', async () => {
    const update = jest.fn();
    const auditAppend = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PENDING_COLLECTION,
          partnerReference: 'partner_duplicate',
        }),
        update,
      },
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: auditAppend },
      noopLedger,
    );

    await expect(
      processor.handlePartnerCallback(
        transaction.reference,
        TransactionStatus.PENDING_COLLECTION,
        'partner_duplicate',
      ),
    ).resolves.toEqual({ applied: false });
    expect(update).not.toHaveBeenCalled();
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'transfer.callback.duplicate' }),
    );
  });

  it('rejects a callback that skips required lifecycle states', async () => {
    const update = jest.fn();
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...transaction,
          status: TransactionStatus.PENDING_COLLECTION,
        }),
        update,
      },
    } as unknown as PrismaService;
    const processor = new WorkerJobProcessor(
      prisma,
      {} as PartnerPort,
      { append: jest.fn().mockResolvedValue(undefined) },
      noopLedger,
    );

    await expect(
      processor.handlePartnerCallback(
        transaction.reference,
        TransactionStatus.PAYOUT_SUCCESS,
        'partner_invalid',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_TRANSITION' });
    expect(update).not.toHaveBeenCalled();
  });
});
