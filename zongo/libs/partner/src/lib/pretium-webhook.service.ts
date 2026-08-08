import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AUDIT_LOG_PORT,
  DomainError,
  TransferLifecyclePolicy,
  type AuditLogPort,
} from '@app/domain';
import { PrismaService } from '@app/db';
import { LedgerService } from '@app/ledger';
import { TransactionStatus } from '@prisma/client';
import {
  ENVELOPE_ENCRYPTION,
  type EnvelopeEncryptionService,
} from '@app/security';

export class PretiumWebhookSignatureService {
  verify(rawBody: string, signature: string | undefined): boolean {
    const secret = process.env.PRETIUM_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const actual = signature.replace(/^sha256=/, '');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return (
      actual.length === expected.length &&
      timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    );
  }
}

@Injectable()
export class PretiumWebhookService {
  private readonly lifecycle = new TransferLifecyclePolicy();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    private readonly ledger: LedgerService,
    @Optional()
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection?: EnvelopeEncryptionService,
  ) {}

  async apply(input: {
    partnerReference: string;
    providerStatus: string;
  }): Promise<{ applied: boolean; transactionReference?: string }> {
    const providerReferenceBlindIndex = this.protection
      ? await this.protection.blindIndex(
          input.partnerReference,
          'provider-reference',
        )
      : undefined;
    const transaction = await this.prisma.transferTransaction.findFirst({
      where: {
        OR: [
          { partnerReference: input.partnerReference },
          ...(providerReferenceBlindIndex
            ? [{ partnerReferenceBlindIndex: providerReferenceBlindIndex }]
            : []),
        ],
      },
    });
    if (!transaction)
      throw new DomainError(
        'PARTNER_CALLBACK_UNKNOWN',
        'The callback reference is not known',
      );
    const status = this.mapStatus(input.providerStatus, transaction.status);
    const closed =
      transaction.status === TransactionStatus.COLLECTION_FAILED ||
      transaction.status === TransactionStatus.PAYOUT_FAILED ||
      transaction.status === TransactionStatus.PAYOUT_SUCCESS;
    if (closed) {
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'TECHNICAL',
        name:
          transaction.status === status
            ? 'transfer.callback.duplicate'
            : 'transfer.callback.late',
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: {
          currentStatus: transaction.status,
          receivedStatus: status,
          partnerReference: input.partnerReference,
        },
        createdAt: new Date(),
      });
      return { applied: false, transactionReference: transaction.reference };
    }
    if (transaction.status === status) {
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'TECHNICAL',
        name: 'transfer.callback.duplicate',
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: { status, partnerReference: input.partnerReference },
        createdAt: new Date(),
      });
      return { applied: false, transactionReference: transaction.reference };
    }
    try {
      this.lifecycle.assertTransition(transaction.status, status);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === 'INVALID_TRANSACTION_TRANSITION'
      ) {
        await this.audit.append({
          id: crypto.randomUUID(),
          eventType: 'TECHNICAL',
          name: 'transfer.callback.out-of-order',
          transactionId: transaction.id,
          corridorId: transaction.corridorId,
          payload: {
            currentStatus: transaction.status,
            receivedStatus: status,
            partnerReference: input.partnerReference,
          },
          createdAt: new Date(),
        });
        return { applied: false, transactionReference: transaction.reference };
      }
      throw error;
    }
    const applied = await this.prisma.$transaction(async (tx) => {
      const result = await tx.transferTransaction.updateMany({
        where: { id: transaction.id, status: transaction.status },
        data: {
          status,
          partnerReference: input.partnerReference,
          ...(providerReferenceBlindIndex
            ? { partnerReferenceBlindIndex: providerReferenceBlindIndex }
            : {}),
        },
      });
      if (result.count === 1 && status === TransactionStatus.COLLECTION_SUCCESS)
        await tx.workerJob.upsert({
          where: { dedupKey: `${transaction.reference}:PAYOUT` },
          create: {
            dedupKey: `${transaction.reference}:PAYOUT`,
            transactionReference: transaction.reference,
            transactionId: transaction.id,
            jobType: 'PAYOUT',
            payload: { reason: 'COLLECTION_SUCCESS' },
          },
          update: {},
        });
      return result;
    });
    if (applied.count !== 1) {
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'TECHNICAL',
        name: 'transfer.callback.concurrent-state-change',
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: {
          observedStatus: transaction.status,
          receivedStatus: status,
          partnerReference: input.partnerReference,
        },
        createdAt: new Date(),
      });
      return { applied: false, transactionReference: transaction.reference };
    }
    if (
      status === TransactionStatus.COLLECTION_SUCCESS ||
      status === TransactionStatus.PAYOUT_SUCCESS
    ) {
      await this.ledger.appendLifecycleEntries(
        transaction.id,
        status === TransactionStatus.COLLECTION_SUCCESS
          ? 'collection'
          : 'payout',
      );
      await this.ledger.persistReconciliation(transaction.id);
    }
    await this.resolveTransferOutcome(transaction.id, status);
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name: 'transfer.callback.applied',
      transactionId: transaction.id,
      corridorId: transaction.corridorId,
      payload: { status, partnerReference: input.partnerReference },
      createdAt: new Date(),
    });
    return { applied: true, transactionReference: transaction.reference };
  }

  private async resolveTransferOutcome(
    transactionId: string,
    status: TransactionStatus,
  ): Promise<void> {
    if (
      status !== TransactionStatus.COLLECTION_FAILED &&
      status !== TransactionStatus.PAYOUT_SUCCESS &&
      status !== TransactionStatus.PAYOUT_FAILED
    )
      return;
    const session = await this.prisma.whatsAppSession?.findUnique({
      where: { transferId: transactionId },
    });
    if (!session?.senderPhoneCiphertext) return;
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { id: transactionId } },
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppSession.update({
        where: { id: session.id },
        data: { status: 'CLOSED', activeChatKey: null },
      });
      const intent = await tx.notificationIntent.upsert({
        where: { dedupKey: `transfer:${transaction.id}:resolved` },
        create: {
          dedupKey: `transfer:${transaction.id}:resolved`,
          transactionId: transaction.id,
          channel: 'WHATSAPP',
          recipientPhoneCiphertext: session.senderPhoneCiphertext,
          template: 'transfer.resolved',
          payload: { status, reference: transaction.reference },
        },
        update: {},
      });
      await tx.workerJob.upsert({
        where: { dedupKey: `notification:${intent.id}` },
        create: {
          dedupKey: `notification:${intent.id}`,
          jobType: 'NOTIFICATION',
          transactionReference: transaction.reference,
          transactionId: transaction.id,
          payload: { notificationIntentId: intent.id },
        },
        update: {},
      });
    });
  }

  private mapStatus(
    providerStatus: string,
    current: TransactionStatus,
  ): TransactionStatus {
    const normalized = providerStatus.toUpperCase();
    const payout =
      current === TransactionStatus.PENDING_PAYOUT ||
      current === TransactionStatus.PAYOUT_SUCCESS ||
      current === TransactionStatus.PAYOUT_FAILED;
    if (
      normalized === 'COMPLETE' ||
      normalized === 'SUCCESS' ||
      normalized === 'SUCCEEDED'
    )
      return payout
        ? TransactionStatus.PAYOUT_SUCCESS
        : TransactionStatus.COLLECTION_SUCCESS;
    if (
      normalized === 'FAILED' ||
      normalized === 'FAILURE' ||
      normalized === 'REJECTED'
    )
      return payout
        ? TransactionStatus.PAYOUT_FAILED
        : TransactionStatus.COLLECTION_FAILED;
    return payout
      ? TransactionStatus.PENDING_PAYOUT
      : TransactionStatus.PENDING_COLLECTION;
  }
}
