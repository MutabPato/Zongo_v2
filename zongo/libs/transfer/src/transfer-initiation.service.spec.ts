/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { TransactionReferenceService } from '@app/domain';
import { TransferInitiationService } from './transfer-initiation.service';

describe('TransferInitiationService', () => {
  it('atomically creates an accepted transfer, collection job, session ownership, and audit fact', async () => {
    const transaction = {
      id: 'tx_1',
      reference: 'ZNG-TEST-001',
      senderUserId: 'user_1',
      beneficiaryId: 'ben_1',
      sendAmountMinor: 100n,
      metadata: { quoteId: 'quote_1' },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      pilotControl: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'GLOBAL', state: 'ENABLED' },
          { key: 'INITIATION', state: 'ENABLED' },
          { key: 'CORRIDOR_PROVIDER', state: 'ENABLED' },
        ]),
      },
      pilotExposurePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      transferTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { sendAmountMinor: 0n } }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(transaction),
      },
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session_1',
          senderPhoneNumber: '+243800000001',
          transferId: null,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      senderProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'profile_1',
          userId: 'user_1',
          senderPhoneNumber: '+243800000001',
          tier: 'TIER_1',
          tierLimitOverride: null,
          pilotAllowlist: null,
        }),
      },
      platformIdentity: {
        findUnique: jest.fn().mockResolvedValue({ blockedAt: null }),
      },
      beneficiary: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ben_1',
          userId: 'user_1',
          corridorId: 'corr_1',
          isCurrent: true,
        }),
      },
      corridorPolicy: {
        findFirst: jest.fn().mockResolvedValue({
          sendCurrency: 'CDF',
          payoutCurrency: 'KES',
          minSendAmountMinor: null,
          maxSendAmountMinor: null,
        }),
      },
      workerJob: { create: jest.fn().mockResolvedValue(undefined) },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const audit = { append: jest.fn() } as unknown as AuditLogPort;
    const references = {
      generate: jest.fn().mockReturnValue('ZNG-TEST-001'),
    } as unknown as TransactionReferenceService;
    const protection = {
      blindIndex: jest.fn().mockResolvedValue('blind:+243800000001'),
    } as any;

    const service = new TransferInitiationService(
      prisma,
      references,
      audit,
      protection,
    );
    const result = await service.initiate({
      senderProfileId: 'profile_1',
      senderPhoneNumber: '+243800000001',
      chatId: 'chat_1',
      inboundEventId: 'event_1',
      corridorId: 'corr_1',
      beneficiaryId: 'ben_1',
      sendAmountMinor: 100n,
      sendCurrency: 'CDF',
      payoutAmountMinor: 250n,
      payoutCurrency: 'KES',
      quoteId: 'quote_1',
      quoteSnapshot: { rate: '2.5' },
      idempotencyKey: 'init_1',
    });

    expect(result).toEqual({ duplicate: false, accepted: transaction });
    expect(tx.workerJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionId: transaction.id,
          jobType: 'COLLECTION',
        }),
      }),
    );
    expect(tx.whatsAppSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { transferId: transaction.id },
      }),
    );

    tx.pilotControl.findMany.mockResolvedValueOnce([]);
    await expect(
      service.initiate({
        senderProfileId: 'profile_1',
        senderPhoneNumber: '+243800000001',
        chatId: 'chat_2',
        inboundEventId: 'event_2',
        corridorId: 'corr_1',
        beneficiaryId: 'ben_1',
        sendAmountMinor: 100n,
        sendCurrency: 'CDF',
        payoutAmountMinor: 250n,
        payoutCurrency: 'KES',
        quoteId: 'quote_1',
        quoteSnapshot: { rate: '2.5' },
        idempotencyKey: 'init_2',
      }),
    ).rejects.toMatchObject({ code: 'PILOT_INITIATION_PAUSED' });
  });
});
