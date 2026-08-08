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
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      transferTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tx_1',
          reference: 'ZNG-1',
          corridorId: 'corr_1',
          status: 'PENDING_PAYOUT',
          partnerReference: 'pt_1',
        }),
        update,
      },
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
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PAYOUT_SUCCESS', partnerReference: 'pt_1' },
      }),
    );
    expect(appendLifecycleEntries).toHaveBeenCalledWith('tx_1', 'payout');
  });

  it('can resolve callbacks through the keyed provider-reference index', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'tx_2',
      reference: 'ZNG-2',
      corridorId: 'corr_1',
      status: 'PENDING_PAYOUT',
      partnerReference: null,
    });
    const prisma = {
      transferTransaction: { findFirst, update },
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
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          partnerReferenceBlindIndex: 'blind-provider-ref',
        }),
      }),
    );
  });
});
