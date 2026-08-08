/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createHmac } from 'node:crypto';
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import {
  parseWhatsAppMessage,
  WhatsAppSessionService,
  WhatsAppWebhookSignatureService,
  MetaWhatsAppNotifier,
} from './whatsapp.service';

describe('WhatsApp message grammar', () => {
  it.each([
    ['send money', 'START_TRANSFER', 'EN'],
    ['envoyer argent', 'START_TRANSFER', 'FR'],
    ['tuma pesa', 'START_TRANSFER', 'SW'],
    ['oui, j’accepte', 'CONSENT', 'FR'],
    ['status', 'STATUS', 'EN'],
    ['hali ya muamala', 'STATUS', 'SW'],
    ['annuler', 'CANCEL', 'FR'],
  ])('normalizes %s', (message, intent, locale) => {
    expect(parseWhatsAppMessage(message)).toEqual(
      expect.objectContaining({ intent, locale }),
    );
  });
});

describe('WhatsAppWebhookSignatureService', () => {
  it('accepts a valid Meta-style signature and rejects tampering', () => {
    const body = JSON.stringify({ id: 'event_1' });
    const secret = 'app-secret';
    const signature = `sha256=${createHmac('sha256', secret)
      .update(body)
      .digest('hex')}`;
    const service = new WhatsAppWebhookSignatureService();

    expect(service.verify(body, signature, secret)).toBe(true);
    expect(service.verify(`${body}x`, signature, secret)).toBe(false);
    expect(service.verify(body, undefined, secret)).toBe(false);
  });
});

describe('WhatsAppSessionService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;
  const protection = {
    encrypt: jest.fn((value: string) => ({
      algorithm: 'aes-256-gcm' as const,
      keyVersion: 'v1',
      iv: 'iv',
      ciphertext: value,
      authTag: 'tag',
    })),
    blindIndex: jest.fn((value: string) => `blind:${value}`),
  } as any;

  it('deduplicates inbound events and blocks a second active chat session', async () => {
    const sessionCreate = jest.fn().mockResolvedValue({ id: 'session_1' });
    const tx = {
      whatsAppInboundEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'event_1' }),
        create: jest.fn(),
      },
      whatsAppSession: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'session_existing' }),
        create: sessionCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new WhatsAppSessionService(prisma, audit, protection);

    await expect(
      service.acceptInbound({
        externalEventId: 'event_1',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
      }),
    ).resolves.toEqual({
      duplicate: false,
      accepted: true,
      sessionId: 'session_1',
    });
    await expect(
      service.acceptInbound({
        externalEventId: 'event_2',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
      }),
    ).resolves.toEqual({
      duplicate: false,
      accepted: false,
      reason: 'ACTIVE_TRANSFER_SESSION',
      sessionId: 'session_existing',
    });
    await expect(
      service.acceptInbound({
        externalEventId: 'event_1',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
      }),
    ).resolves.toEqual({ duplicate: true, accepted: false });
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('moves an expired session to waiting and queues a durable status recheck', async () => {
    const sessionUpdate = jest.fn().mockResolvedValue({
      id: 'session_1',
      status: 'WAITING',
    });
    const workerUpsert = jest.fn().mockResolvedValue(undefined);
    const tx = {
      whatsAppSession: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'session_1',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() - 1_000),
          transferId: 'tx_1',
        }),
        update: sessionUpdate,
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'tx_1',
          reference: 'ZNG-TEST-001',
        }),
      },
      workerJob: { upsert: workerUpsert },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new WhatsAppSessionService(prisma, audit, protection);

    await expect(service.expireSession('session_1')).resolves.toEqual({
      id: 'session_1',
      status: 'WAITING',
      transferId: 'tx_1',
    });
    expect(workerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupKey: 'timeout-status-recheck:ZNG-TEST-001' },
        create: expect.objectContaining({ jobType: 'STATUS_RECHECK' }),
      }),
    );
  });

  it('turns a waiting-session message into a status-only recheck', async () => {
    const workerUpsert = jest.fn().mockResolvedValue(undefined);
    const tx = {
      whatsAppInboundEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session_waiting',
          status: 'WAITING',
          transferId: 'tx_1',
        }),
        create: jest.fn(),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'tx_1',
          reference: 'ZNG-TEST-001',
        }),
      },
      workerJob: { upsert: workerUpsert },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new WhatsAppSessionService(prisma, audit, protection);

    await expect(
      service.acceptInbound({
        externalEventId: 'status_event_1',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
      }),
    ).resolves.toEqual({
      duplicate: false,
      accepted: false,
      reason: 'WAITING_STATUS_ONLY',
      sessionId: 'session_waiting',
      transferId: 'tx_1',
    });
    expect(workerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupKey: 'status-query:ZNG-TEST-001' },
      }),
    );
  });

  it('cancels an unaccepted session but never cancels an accepted transfer', async () => {
    const sessionUpdate = jest.fn().mockResolvedValue({ id: 'session_1' });
    const tx = {
      whatsAppInboundEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      whatsAppSession: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'session_1',
            status: 'ACTIVE',
            transferId: null,
          })
          .mockResolvedValueOnce({
            id: 'session_2',
            status: 'ACTIVE',
            transferId: 'tx_1',
          }),
        update: sessionUpdate,
      },
      workerJob: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new WhatsAppSessionService(prisma, audit, protection);

    await expect(
      service.acceptInbound({
        externalEventId: 'cancel_1',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
        messageText: 'annuler',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ reason: 'SESSION_CANCELLED' }),
    );
    await expect(
      service.acceptInbound({
        externalEventId: 'cancel_2',
        chatId: 'chat_1',
        senderPhoneNumber: '+243800000001',
        messageText: 'cancel',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        reason: 'CANCEL_NOT_AVAILABLE_AFTER_ACCEPTANCE',
        transferId: 'tx_1',
      }),
    );
    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CLOSED', activeChatKey: null },
      }),
    );
  });

  it('persists notification intent and a durable notification job idempotently', async () => {
    const intent = { id: 'intent_1', dedupKey: 'transfer_1:resolved' };
    const tx = {
      notificationIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(intent),
      },
      workerJob: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new WhatsAppSessionService(prisma, audit, protection);

    await expect(
      service.createNotificationIntent({
        dedupKey: 'transfer_1:resolved',
        transactionId: 'tx_1',
        recipientPhoneNumber: '+243800000001',
        template: 'transfer.resolved',
        payload: { status: 'PAYOUT_SUCCESS' },
      }),
    ).resolves.toEqual({ duplicate: false, intent });
    expect(tx.workerJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobType: 'NOTIFICATION' }),
      }),
    );
  });
});

describe('MetaWhatsAppNotifier', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts an approved-template notification through the configured sender', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await new MetaWhatsAppNotifier('phone-number-id', 'access-token').send({
      recipientPhoneNumber: '+243800000001',
      template: 'transfer.resolved',
      payload: { reference: 'ZNG-1', status: 'PAYOUT_SUCCESS' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/phone-number-id/messages'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
        }),
        body: expect.stringContaining('transfer_resolved'),
      }),
    );
  });

  it('does not include the raw Meta response in notification errors', async () => {
    const response = new Response(
      '{"access_token":"secret","recipient":"+243800000001"}',
      { status: 400 },
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(
      new MetaWhatsAppNotifier('phone-number-id', 'access-token').send({
        recipientPhoneNumber: '+243800000001',
        template: 'transfer.resolved',
        payload: {},
      }),
    ).rejects.toThrow('WhatsApp notification failed (400)');
    await expect(
      new MetaWhatsAppNotifier('phone-number-id', 'access-token').send({
        recipientPhoneNumber: '+243800000001',
        template: 'transfer.resolved',
        payload: {},
      }),
    ).rejects.not.toThrow('secret');
  });
});
