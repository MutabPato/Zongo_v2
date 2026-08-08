import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { Prisma } from '@prisma/client';
import { ENVELOPE_ENCRYPTION, EnvelopeEncryptionService } from '@app/security';

export const WHATSAPP_APP_SECRET = Symbol('WHATSAPP_APP_SECRET');
export const WHATSAPP_NOTIFIER = Symbol('WHATSAPP_NOTIFIER');

export interface WhatsAppNotificationPort {
  send(input: {
    recipientPhoneNumber: string;
    template: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export const unavailableWhatsAppNotifier: WhatsAppNotificationPort = {
  send: () => Promise.reject(new Error('WhatsApp notifier is not configured')),
};

export class MetaWhatsAppNotifier implements WhatsAppNotificationPort {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly graphVersion = process.env.META_GRAPH_VERSION ?? 'v20.0',
  ) {}

  async send(input: {
    recipientPhoneNumber: string;
    template: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const parameters = Object.values(input.payload).map((value) => ({
      type: 'text',
      text: String(value),
    }));
    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: input.recipientPhoneNumber,
          type: 'template',
          template: {
            name: input.template.replace(/[^a-zA-Z0-9_]/g, '_'),
            language: {
              code: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE ?? 'en',
            },
            components: parameters.length
              ? [{ type: 'body', parameters }]
              : undefined,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `WhatsApp notification failed (${response.status}): ${detail.slice(0, 200)}`,
      );
    }
  }
}

export type WhatsAppInboundInput = {
  externalEventId: string;
  chatId: string;
  senderPhoneNumber: string;
  payloadRedacted?: Record<string, unknown>;
  consentGiven?: boolean;
};

export type NotificationIntentInput = {
  dedupKey: string;
  transactionId?: string;
  recipientPhoneNumber: string;
  template: string;
  payload: Record<string, unknown>;
};

export class WhatsAppWebhookSignatureService {
  verify(rawBody: string, signature: string | undefined, appSecret: string) {
    if (!signature?.startsWith('sha256=') || !appSecret) return false;
    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const actual = signature.slice('sha256='.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }
}

@Injectable()
export class WhatsAppSessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection: EnvelopeEncryptionService,
  ) {}

  async acceptInbound(input: WhatsAppInboundInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.whatsAppInboundEvent.findUnique({
        where: { externalEventId: input.externalEventId },
      });
      if (existing) return { duplicate: true, accepted: false as const };

      await tx.whatsAppInboundEvent.create({
        data: {
          externalEventId: input.externalEventId,
          chatId: input.chatId,
          senderPhoneNumber: undefined,
          senderPhoneCiphertext: JSON.stringify(
            await this.protection.encrypt(
              input.senderPhoneNumber,
              'sender-phone',
            ),
          ),
          senderPhoneBlindIndex: await this.protection.blindIndex(
            input.senderPhoneNumber,
            'sender-phone',
          ),
          payloadRedacted: input.payloadRedacted as Prisma.InputJsonValue,
        },
      });

      const active = await tx.whatsAppSession.findUnique({
        where: { activeChatKey: `chat:${input.chatId}` },
      });
      const phoneIndex = await this.protection.blindIndex(
        input.senderPhoneNumber,
        'sender-phone',
      );
      if (active) {
        if (active.status === 'WAITING' && active.transferId) {
          const transfer = await tx.transferTransaction.findUniqueOrThrow({
            where: { id: active.transferId },
          });
          await tx.workerJob.upsert({
            where: { dedupKey: `status-query:${transfer.reference}` },
            create: {
              dedupKey: `status-query:${transfer.reference}`,
              jobType: 'STATUS_RECHECK',
              transactionReference: transfer.reference,
              transactionId: transfer.id,
              payload: { reason: 'CUSTOMER_STATUS_QUERY' },
            },
            update: {},
          });
          return {
            duplicate: false,
            accepted: false as const,
            reason: 'WAITING_STATUS_ONLY',
            sessionId: active.id,
            transferId: active.transferId,
          };
        }
        return {
          duplicate: false,
          accepted: false as const,
          reason: 'ACTIVE_TRANSFER_SESSION',
          sessionId: active.id,
        };
      }

      const session = await tx.whatsAppSession.create({
        data: {
          chatId: input.chatId,
          senderPhoneNumber: undefined,
          senderPhoneCiphertext: JSON.stringify(
            await this.protection.encrypt(
              input.senderPhoneNumber,
              'sender-phone',
            ),
          ),
          senderPhoneBlindIndex: phoneIndex,
          activeChatKey: `chat:${input.chatId}`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      return {
        duplicate: false,
        accepted: true as const,
        sessionId: session.id,
      };
    });

    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'TECHNICAL',
      name: result.duplicate
        ? 'whatsapp.inbound.duplicate'
        : result.accepted
          ? 'whatsapp.session.accepted'
          : 'whatsapp.session.blocked',
      payload: {
        externalEventId: input.externalEventId,
        chatId: input.chatId,
        reason: 'reason' in result ? result.reason : undefined,
      },
      createdAt: new Date(),
    });
    return result;
  }

  async expireSession(sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.whatsAppSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      if (
        session.status !== 'ACTIVE' ||
        !session.expiresAt ||
        session.expiresAt > new Date()
      )
        throw new Error(
          'Only an expired active session can enter waiting state',
        );
      if (!session.transferId) {
        return tx.whatsAppSession.update({
          where: { id: session.id },
          data: { status: 'CLOSED', activeChatKey: null },
        });
      }
      const transfer = await tx.transferTransaction.findUniqueOrThrow({
        where: { id: session.transferId },
      });
      await tx.whatsAppSession.update({
        where: { id: session.id },
        data: { status: 'WAITING', expiresAt: null },
      });
      await tx.workerJob.upsert({
        where: { dedupKey: `timeout-status-recheck:${transfer.reference}` },
        create: {
          dedupKey: `timeout-status-recheck:${transfer.reference}`,
          jobType: 'STATUS_RECHECK',
          transactionReference: transfer.reference,
          transactionId: transfer.id,
          payload: { reason: 'SESSION_TIMEOUT' },
        },
        update: {},
      });
      return {
        id: session.id,
        status: 'WAITING' as const,
        transferId: transfer.id,
      };
    });
  }

  async createNotificationIntent(input: NotificationIntentInput) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.notificationIntent.findUnique({
        where: { dedupKey: input.dedupKey },
      });
      if (existing) return { duplicate: true, intent: existing };
      const encryptedRecipient = await this.protection.encrypt(
        input.recipientPhoneNumber,
        'sender-phone',
      );
      const intent = await tx.notificationIntent.create({
        data: {
          dedupKey: input.dedupKey,
          transactionId: input.transactionId,
          channel: 'WHATSAPP',
          recipientPhoneCiphertext: JSON.stringify(encryptedRecipient),
          template: input.template,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
      await tx.workerJob.create({
        data: {
          dedupKey: `notification:${intent.id}`,
          jobType: 'NOTIFICATION',
          transactionReference: input.transactionId ?? intent.id,
          transactionId: input.transactionId,
          payload: { notificationIntentId: intent.id },
        },
      });
      return { duplicate: false, intent };
    });
  }
}
