/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { createHmac } from 'node:crypto';
import {
  CurrencyCode,
  TransactionStatus,
  WhatsappSessionState,
} from '@prisma/client';
import type { AuditLogPort, PartnerPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { TransactionReferenceService } from '@app/domain';
import {
  WhatsappTransferService,
  type WhatsappMessengerPort,
} from './whatsapp-transfer.service';

describe('WhatsappTransferService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;
  const messenger = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as WhatsappMessengerPort;
  const partner = {
    collect: jest.fn(),
    payout: jest.fn(),
    getTransferStatus: jest.fn(),
  } as unknown as PartnerPort;
  const input = {
    chatId: 'chat_1',
    senderUserId: 'sender_1',
    corridorId: 'corr_1',
    beneficiaryId: 'ben_1',
    sendAmountMinor: 1250n,
    sendCurrency: CurrencyCode.USD,
    idempotencyKey: 'idem_1',
  };

  it('verifies Meta signatures and renders customer messages with fiat only', () => {
    const service = new WhatsappTransferService(
      {} as PrismaService,
      new TransactionReferenceService(),
      partner,
      audit,
      messenger,
    );
    const raw = '{"message":"hello"}';
    const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    expect(service.verifyMetaSignature(raw, signature, 'secret')).toBe(true);
    expect(service.verifyMetaSignature(raw, 'sha256=bad', 'secret')).toBe(
      false,
    );
    expect(service.formatFiatMessage(1250n, CurrencyCode.USD, 'started')).toBe(
      'Your USD 12.50 transfer is started.',
    );
  });

  it('blocks a second transfer for the same chat', async () => {
    const transaction = {
      id: 'tx_1',
      reference: 'ZNG-1',
      sendAmountMinor: 1250n,
      sendCurrency: CurrencyCode.USD,
    };
    const create = jest
      .fn()
      .mockResolvedValueOnce({ transactionId: transaction.id, transaction })
      .mockRejectedValueOnce(new Error('unique constraint'));
    const prisma = { whatsappSession: { create } } as unknown as PrismaService;
    const service = new WhatsappTransferService(
      prisma,
      new TransactionReferenceService(),
      partner,
      audit,
      messenger,
    );
    await expect(service.start(input)).resolves.toEqual(
      expect.objectContaining({ blocked: false }),
    );
    await expect(
      service.start({ ...input, idempotencyKey: 'idem_2' }),
    ).resolves.toEqual(
      expect.objectContaining({
        blocked: true,
        message: expect.stringContaining('finish or cancel'),
      }),
    );
  });

  it('rechecks timed-out transfers and keeps ambiguous sessions waiting', async () => {
    const session = {
      id: 'session_1',
      transactionId: 'tx_1',
      transaction: { reference: 'ZNG-1' },
    };
    partner.getTransferStatus = jest.fn().mockResolvedValue('AMBIGUOUS');
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      whatsappSession: {
        findMany: jest.fn().mockResolvedValue([session]),
        update,
      },
    } as unknown as PrismaService;
    await new WhatsappTransferService(
      prisma,
      new TransactionReferenceService(),
      partner,
      audit,
      messenger,
    ).releaseTimedOutSessions(new Date());
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: WhatsappSessionState.WAITING }),
      }),
    );
  });

  it('proactively notifies when a waiting transfer resolves', async () => {
    const session = {
      id: 'session_1',
      chatId: 'chat_1',
      transactionId: 'tx_1',
      transaction: { sendAmountMinor: 2500n, sendCurrency: CurrencyCode.KES },
    };
    const prisma = {
      whatsappSession: {
        findFirstOrThrow: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockReturnValue({}),
      },
      transferTransaction: { update: jest.fn().mockReturnValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new WhatsappTransferService(
      prisma,
      new TransactionReferenceService(),
      partner,
      audit,
      messenger,
    ).resolveWaitingTransfer('ZNG-1', TransactionStatus.PAYOUT_SUCCESS);
    expect(messenger.send).toHaveBeenCalledWith(
      'chat_1',
      'Your KES 25.00 transfer is completed.',
    );
  });
});
