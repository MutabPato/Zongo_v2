import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AUDIT_LOG_PORT,
  PARTNER_PORT,
  TransactionReferenceService,
  type AuditLogPort,
  type PartnerPort,
} from '@app/domain';
import { PrismaService } from '@app/db';
import {
  CurrencyCode,
  Prisma,
  TransactionStatus,
  TransferInitiationChannel,
  WhatsappSessionState,
} from '@prisma/client';

export const WHATSAPP_MESSENGER = Symbol('WHATSAPP_MESSENGER');
export interface WhatsappMessengerPort {
  send(chatId: string, message: string): Promise<void>;
}

export type StartWhatsappTransferInput = {
  chatId: string;
  senderUserId: string;
  corridorId: string;
  beneficiaryId: string;
  sendAmountMinor: bigint;
  sendCurrency: CurrencyCode;
  idempotencyKey: string;
};

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class WhatsappTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: TransactionReferenceService,
    @Inject(PARTNER_PORT) private readonly partner: PartnerPort,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    @Inject(WHATSAPP_MESSENGER)
    private readonly messenger: WhatsappMessengerPort,
  ) {}

  verifyMetaSignature(
    rawBody: string,
    signature: string | undefined,
    appSecret: string,
  ): boolean {
    if (!signature?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const received = signature.slice('sha256='.length);
    if (received.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  async start(input: StartWhatsappTransferInput) {
    const reference = this.references.generate();
    try {
      const session = await this.prisma.whatsappSession.create({
        data: {
          chatId: input.chatId,
          senderUserId: input.senderUserId,
          expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS),
          transaction: {
            create: {
              reference,
              corridorId: input.corridorId,
              senderUserId: input.senderUserId,
              beneficiaryId: input.beneficiaryId,
              sendAmountMinor: input.sendAmountMinor,
              sendCurrency: input.sendCurrency,
              idempotencyKey: input.idempotencyKey,
              initiationChannel: TransferInitiationChannel.WHATSAPP,
              whatsappChatId: input.chatId,
            },
          },
        },
        include: { transaction: true },
      });
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'BUSINESS',
        name: 'whatsapp.transfer.started',
        actorType: 'WHATSAPP_CHAT',
        actorId: input.chatId,
        transactionId: session.transactionId,
        payload: { reference },
        createdAt: new Date(),
      });
      return {
        blocked: false as const,
        transaction: session.transaction,
        message: this.formatFiatMessage(
          session.transaction.sendAmountMinor,
          session.transaction.sendCurrency,
          'started',
        ),
      };
    } catch (error) {
      if (this.isUniqueViolation(error))
        return {
          blocked: true as const,
          message:
            'You already have a transfer in progress. Please finish or cancel it before starting another.',
        };
      throw error;
    }
  }

  async releaseTimedOutSessions(now = new Date()): Promise<void> {
    const sessions = await this.prisma.whatsappSession.findMany({
      where: { state: WhatsappSessionState.ACTIVE, expiresAt: { lte: now } },
      include: { transaction: true },
    });
    for (const session of sessions) {
      const status = await this.partner.getTransferStatus(
        session.transaction.reference,
      );
      if (status === 'AMBIGUOUS') {
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: { state: WhatsappSessionState.WAITING, waitingSince: now },
        });
        await this.audit.append({
          id: crypto.randomUUID(),
          eventType: 'TECHNICAL',
          name: 'whatsapp.session.waiting',
          transactionId: session.transactionId,
          payload: { reason: 'partner-status-ambiguous' },
          createdAt: now,
        });
      } else {
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: { state: WhatsappSessionState.RELEASED, releasedAt: now },
        });
      }
    }
  }

  async resolveWaitingTransfer(
    reference: string,
    status: TransactionStatus,
  ): Promise<void> {
    const session = await this.prisma.whatsappSession.findFirstOrThrow({
      where: {
        state: WhatsappSessionState.WAITING,
        transaction: { reference },
      },
      include: { transaction: true },
    });
    await this.prisma.$transaction([
      this.prisma.transferTransaction.update({
        where: { id: session.transactionId },
        data: { status },
      }),
      this.prisma.whatsappSession.update({
        where: { id: session.id },
        data: { state: WhatsappSessionState.RELEASED, releasedAt: new Date() },
      }),
    ]);
    await this.messenger.send(
      session.chatId,
      this.formatFiatMessage(
        session.transaction.sendAmountMinor,
        session.transaction.sendCurrency,
        status === TransactionStatus.PAYOUT_SUCCESS ? 'completed' : 'updated',
      ),
    );
  }

  formatFiatMessage(
    amountMinor: bigint,
    currency: CurrencyCode,
    outcome: string,
  ): string {
    const amount = (Number(amountMinor) / 100).toFixed(2);
    return `Your ${currency} ${amount} transfer is ${outcome}.`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002') ||
      (error instanceof Error && /unique/i.test(error.message))
    );
  }
}
