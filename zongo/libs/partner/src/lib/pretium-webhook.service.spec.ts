import type { AuditLogPort } from '@app/domain';
import type { LedgerService } from '@app/ledger';
import type { PrismaService } from '@app/db';
import {
  PretiumWebhookService,
  PretiumWebhookSignatureService,
} from './pretium-webhook.service';
import { createHmac } from 'node:crypto';
import type { EnvelopeEncryptionService } from '@app/security';

describe('Pretium webhook boundary', () => {
  afterEach(() => {
    delete process.env.PRETIUM_WEBHOOK_SECRET;
  });

  it('fails closed when account-specific webhook authentication is absent', () => {
    expect(
      new PretiumWebhookSignatureService().verify('{}', 'sha256=anything'),
    ).toBe(false);
  });

  it('verifies the configured signature without exposing the secret', () => {
    process.env.PRETIUM_WEBHOOK_SECRET = 'secret';
    const raw = '{"status":"COMPLETE"}';
    const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    expect(new PretiumWebhookSignatureService().verify(raw, signature)).toBe(
      true,
    );
  });

  it('applies a terminal callback and records reconciliation evidence', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      transferTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tx_1',
          reference: 'ZNG-1',
          corridorId: 'corr_1',
          status: 'PENDING_PAYOUT',
          partnerReference: 'pt_1',
        }),
        updateMany,
      },
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'payout_job_1' }),
      },
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          transferTransaction: { updateMany },
          workerJob: { upsert: jest.fn() },
        } as never),
      ),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const appendLifecycleEntries = jest.fn().mockResolvedValue(undefined);
    const persistReconciliation = jest.fn().mockResolvedValue(undefined);
    const ledger = {
      appendLifecycleEntries,
      persistReconciliation,
    } as unknown as LedgerService;

    await expect(
      new PretiumWebhookService(prisma, audit, ledger).apply({
        partnerReference: 'pt_1',
        providerStatus: 'COMPLETE',
      }),
    ).resolves.toEqual({ applied: true, transactionReference: 'ZNG-1' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PAYOUT_SUCCESS', partnerReference: 'pt_1' },
      }),
    );
    expect(appendLifecycleEntries).toHaveBeenCalledWith('tx_1', 'payout');
  });

  it('can resolve callbacks through the keyed provider-reference index', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({
      id: 'tx_2',
      reference: 'ZNG-2',
      corridorId: 'corr_1',
      status: 'PENDING_PAYOUT',
      partnerReference: null,
    });
    const prisma = {
      transferTransaction: { findFirst, updateMany },
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'payout_job_2' }),
      },
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          transferTransaction: { updateMany },
          workerJob: { upsert: jest.fn() },
        } as never),
      ),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const ledger = {
      appendLifecycleEntries: jest.fn().mockResolvedValue(undefined),
      persistReconciliation: jest.fn().mockResolvedValue(undefined),
    } as unknown as LedgerService;
    const protection = {
      blindIndex: jest.fn().mockResolvedValue('blind-provider-ref'),
    } as unknown as EnvelopeEncryptionService;

    await new PretiumWebhookService(prisma, audit, ledger, protection).apply({
      partnerReference: 'pt-2',
      providerStatus: 'COMPLETE',
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { partnerReference: 'pt-2' },
          { partnerReferenceBlindIndex: 'blind-provider-ref' },
        ],
      },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          partnerReferenceBlindIndex: 'blind-provider-ref',
        }),
      }),
    );
  });

  it('queues a durable payout after a collection-success callback', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const payoutUpsert = jest
      .fn()
      .mockResolvedValue({ id: 'payout_job_collection' });
    const prisma = {
      transferTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tx_collection',
          reference: 'ZNG-COLLECTION',
          corridorId: 'corr_1',
          status: 'PENDING_COLLECTION',
          partnerReference: 'pt_collection',
        }),
        updateMany,
      },
      workerJob: { upsert: payoutUpsert },
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          transferTransaction: { updateMany },
          workerJob: { upsert: payoutUpsert },
        } as never),
      ),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const ledger = {
      appendLifecycleEntries: jest.fn().mockResolvedValue(undefined),
      persistReconciliation: jest.fn().mockResolvedValue(undefined),
    } as unknown as LedgerService;

    await expect(
      new PretiumWebhookService(prisma, audit, ledger).apply({
        partnerReference: 'pt_collection',
        providerStatus: 'COMPLETE',
      }),
    ).resolves.toEqual({
      applied: true,
      transactionReference: 'ZNG-COLLECTION',
    });
    expect(payoutUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupKey: 'ZNG-COLLECTION:PAYOUT' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        create: expect.objectContaining({
          jobType: 'PAYOUT',
          payload: { reason: 'COLLECTION_SUCCESS' },
        }),
      }),
    );
  });

  it('audits and ignores an out-of-order callback without mutating lifecycle state', async () => {
    const updateMany = jest.fn();
    const append = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      transferTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tx_3',
          reference: 'ZNG-3',
          corridorId: 'corr_1',
          status: 'COLLECTION_SUCCESS',
          partnerReference: 'pt_3',
        }),
        updateMany,
      },
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'payout_job_4' }),
      },
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          transferTransaction: { updateMany },
          workerJob: { upsert: jest.fn() },
        } as never),
      ),
    } as unknown as PrismaService;
    const ledger = {
      appendLifecycleEntries: jest.fn(),
      persistReconciliation: jest.fn(),
    } as unknown as LedgerService;

    await expect(
      new PretiumWebhookService(prisma, { append }, ledger).apply({
        partnerReference: 'pt_3',
        providerStatus: 'FAILED',
      }),
    ).resolves.toEqual({ applied: false, transactionReference: 'ZNG-3' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'transfer.callback.out-of-order' }),
    );
  });

  it('does not overwrite a lifecycle state changed by a concurrent callback', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const append = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      transferTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tx_4',
          reference: 'ZNG-4',
          corridorId: 'corr_1',
          status: 'PENDING_COLLECTION',
          partnerReference: 'pt_4',
        }),
        updateMany,
      },
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'payout_job_4' }),
      },
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          transferTransaction: { updateMany },
          workerJob: { upsert: jest.fn() },
        } as never),
      ),
    } as unknown as PrismaService;
    const appendLifecycleEntries = jest.fn();
    const ledger = {
      appendLifecycleEntries,
      persistReconciliation: jest.fn(),
    } as unknown as LedgerService;

    await expect(
      new PretiumWebhookService(prisma, { append }, ledger).apply({
        partnerReference: 'pt_4',
        providerStatus: 'COMPLETE',
      }),
    ).resolves.toEqual({ applied: false, transactionReference: 'ZNG-4' });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'transfer.callback.concurrent-state-change',
      }),
    );
    expect(appendLifecycleEntries).not.toHaveBeenCalled();
  });
});
