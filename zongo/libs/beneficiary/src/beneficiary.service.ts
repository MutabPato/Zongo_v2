import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, DomainError, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { CurrencyCode, TransactionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

export type BeneficiaryDetails = {
  userId: string;
  corridorId: string;
  displayName: string;
  payoutCountryCode: string;
  payoutCurrency: CurrencyCode;
  phoneNumber: string;
  payoutAccount?: Prisma.InputJsonValue;
};

@Injectable()
export class BeneficiaryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
  ) {}

  async create(details: BeneficiaryDetails) {
    const beneficiary = await this.prisma.beneficiary.create({ data: details });
    await this.appendAudit('beneficiary.created', beneficiary.id, {
      familyId: beneficiary.familyId,
    });
    return beneficiary;
  }

  /** Payout target fields are never mutated; a correction becomes a new revision. */
  async revise(
    beneficiaryId: string,
    changes: Omit<BeneficiaryDetails, 'userId' | 'corridorId'>,
  ) {
    const previous = await this.prisma.beneficiary.findUniqueOrThrow({
      where: { id: beneficiaryId },
    });
    if (!previous.isCurrent)
      throw new DomainError(
        'BENEFICIARY_NOT_CURRENT',
        'Only the current beneficiary revision can be changed',
      );

    const next = await this.prisma.beneficiary.create({
      data: {
        userId: previous.userId,
        corridorId: previous.corridorId,
        displayName: changes.displayName,
        payoutCountryCode: changes.payoutCountryCode,
        payoutCurrency: changes.payoutCurrency,
        phoneNumber: changes.phoneNumber,
        payoutAccount: changes.payoutAccount,
        familyId: previous.familyId,
        version: previous.version + 1,
        supersedesId: previous.id,
      },
    });
    await this.prisma.beneficiary.update({
      where: { id: previous.id },
      data: { isCurrent: false },
    });
    await this.appendAudit('beneficiary.revised', next.id, {
      previousBeneficiaryId: previous.id,
      version: next.version,
    });
    return next;
  }

  async listSaved(userId: string, corridorId: string) {
    return this.prisma.beneficiary.findMany({
      where: { userId, corridorId, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async selectForTransfer(
    beneficiaryId: string,
    userId: string,
    corridorId: string,
  ) {
    const beneficiary = await this.prisma.beneficiary.findUniqueOrThrow({
      where: { id: beneficiaryId },
    });
    if (
      beneficiary.userId !== userId ||
      beneficiary.corridorId !== corridorId ||
      !beneficiary.isCurrent
    ) {
      throw new DomainError(
        'BENEFICIARY_NOT_AVAILABLE',
        'The beneficiary cannot be selected for this transfer',
      );
    }
    return beneficiary;
  }

  /** Links only a corrected target; the failed transfer's original beneficiaryId is untouched. */
  async setRetryTarget(transactionId: string, correctedBeneficiaryId: string) {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { id: transactionId } },
    );
    if (transaction.status !== TransactionStatus.PAYOUT_FAILED)
      throw new DomainError(
        'TRANSFER_NOT_RETRYABLE',
        'Only failed payouts can receive a retry target',
      );
    const beneficiary = await this.selectForTransfer(
      correctedBeneficiaryId,
      transaction.senderUserId,
      transaction.corridorId,
    );
    const updated = await this.prisma.transferTransaction.update({
      where: { id: transaction.id },
      data: { retryBeneficiaryId: beneficiary.id },
    });
    await this.appendAudit('beneficiary.retry-target.set', beneficiary.id, {
      transactionId: transaction.id,
      originalBeneficiaryId: transaction.beneficiaryId,
    });
    return updated;
  }

  async reviewForOps(query: {
    search?: string;
    corridorId?: string;
    userId?: string;
  }) {
    return this.prisma.beneficiary.findMany({
      where: {
        corridorId: query.corridorId,
        userId: query.userId,
        OR: query.search
          ? [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { phoneNumber: { contains: query.search } },
            ]
          : undefined,
      },
      include: {
        supersedes: true,
        revisions: true,
        transactions: { select: { id: true, reference: true, status: true } },
        retryTransactions: {
          select: { id: true, reference: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async appendAudit(
    name: string,
    beneficiaryId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name,
      actorType: 'BENEFICIARY',
      actorId: beneficiaryId,
      payload,
      createdAt: new Date(),
    });
  }
}
