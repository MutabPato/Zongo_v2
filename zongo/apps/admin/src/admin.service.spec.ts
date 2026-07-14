/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { PrismaService } from '@app/db';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  it('does not create an admin session without a valid MFA factor', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'admin_1',
      userId: 'admin@example.test',
      role: 'ADMIN',
      blockedAt: null,
      totpSecret: null,
    });
    const createSession = jest.fn();
    const prisma = {
      platformIdentity: { findUniqueOrThrow },
      adminSession: { create: createSession },
      $transaction: jest.fn(),
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).login('admin@example.test', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('lets an MFA-verified support user find a transfer by internal reference', async () => {
    const transaction = {
      id: 'tx_1',
      reference: 'ZNG-2026-0001',
      status: 'PAYOUT_FAILED',
      failedReason: 'Partner timeout',
    };
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'support_1',
          userId: 'support@example.test',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      transferTransaction: {
        findUnique: jest.fn().mockResolvedValue(transaction),
      },
    } as unknown as PrismaService;

    const service = new AdminService(prisma);

    await expect(
      service.searchTransaction('support_1', 'ZNG-2026-0001'),
    ).resolves.toEqual(transaction);
  });

  it('preserves a support note and records its privileged audit context', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'note_1', body: 'Called partner' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'support_1',
          userId: 'support@example.test',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'tx_1' }),
      },
      adminNote: { create },
    } as unknown as PrismaService;

    await new AdminService(prisma, audit).addTransactionNote(
      'support_1',
      'ZNG-2026-0001',
      'Called partner',
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        transactionId: 'tx_1',
        authorIdentityId: 'support_1',
        body: 'Called partner',
      },
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'admin.transaction.note.added',
        actorId: 'support_1',
        payload: expect.objectContaining({
          actorRole: 'SUPPORT',
          body: 'Called partner',
        }),
      }),
    );
  });

  it('denies a support user a manual payout retry', async () => {
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'support_1',
          userId: 'support@example.test',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).retryFailedPayout('support_1', 'ZNG-2026-0001'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('audits an ops payout retry against its original transfer', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const prepareManualPayoutRetry = jest
      .fn()
      .mockResolvedValue({ id: 'job_1' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          userId: 'ops@example.test',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'tx_1' }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma, audit, {
        prepareManualPayoutRetry,
      } as never).retryFailedPayout('ops_1', 'ZNG-2026-0001'),
    ).resolves.toEqual({ id: 'job_1' });

    expect(prepareManualPayoutRetry).toHaveBeenCalledWith(
      'ZNG-2026-0001',
      undefined,
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'admin.transfer.payout-retry.prepared',
        payload: expect.objectContaining({
          originalReference: 'ZNG-2026-0001',
        }),
      }),
    );
  });

  it('allows only an MFA-verified admin to change and audit Tier 0 caps', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const alerts = { sensitiveAction: jest.fn().mockResolvedValue(undefined) };
    const setGlobalTierLimits = jest.fn().mockResolvedValue({ id: 'policy_1' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'admin_1',
          userId: 'admin@example.test',
          role: 'ADMIN',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
    } as unknown as PrismaService;

    await new AdminService(
      prisma,
      audit,
      undefined,
      undefined,
      { setGlobalTierLimits } as never,
      alerts,
    ).setTier0TransferCaps('admin_1', 500_000n, 1_000_000n);

    expect(setGlobalTierLimits).toHaveBeenCalledWith(
      'TIER_0',
      500_000n,
      1_000_000n,
      'admin_1',
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.policy.tier-0-caps.updated' }),
    );
    expect(alerts.sensitiveAction).toHaveBeenCalledWith(
      'admin.policy.tier-0-caps.updated',
      expect.any(Object),
    );
  });

  it('queues an ops status recheck and records its operational and audit results', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const alerts = { sensitiveAction: jest.fn().mockResolvedValue(undefined) };
    const create = jest.fn().mockResolvedValue({ id: 'job_1' });
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          userId: 'ops@example.test',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'tx_1' }),
        update,
      },
      workerJob: { create },
    } as unknown as PrismaService;

    await expect(
      new AdminService(
        prisma,
        audit,
        undefined,
        undefined,
        undefined,
        alerts,
      ).recheckStatus('ops_1', 'ZNG-2026-0001'),
    ).resolves.toEqual({ job: { id: 'job_1' }, result: 'QUEUED' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: 'STATUS_RECHECK',
          transactionId: 'tx_1',
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastStatusRecheckResult: 'QUEUED' }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.transfer.status-recheck.queued' }),
    );
    expect(alerts.sensitiveAction).toHaveBeenCalled();
  });
});
