/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { PrismaService } from '@app/db';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PilotControlKey, PilotControlState } from '@prisma/client';

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

  it('masks provider and customer values in support search results', async () => {
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx_1',
          reference: 'ZNG-2026-0001',
          partnerReference: 'pretium-secret-ref',
          senderPhoneNumber: '+254700000001',
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).searchTransaction('support_1', 'ZNG-2026-0001'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'tx_1',
        reference: 'ZNG-2026-0001',
        partnerReference: '[MASKED]',
        senderPhoneNumber: '[MASKED]',
      }),
    );
    const result = await new AdminService(prisma).searchTransaction(
      'support_1',
      'ZNG-2026-0001',
    );
    expect(JSON.stringify(result)).not.toContain('pretium-secret-ref');
    expect(JSON.stringify(result)).not.toContain('+254700000001');
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

  it('allows only an MFA-verified admin to change and audit Tier 1 caps', async () => {
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
    ).setTier1TransferCaps('admin_1', 500_000n, 1_000_000n);

    expect(setGlobalTierLimits).toHaveBeenCalledWith(
      'TIER_1',
      500_000n,
      1_000_000n,
      'admin_1',
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.policy.tier-1-caps.updated' }),
    );
    expect(alerts.sensitiveAction).toHaveBeenCalledWith(
      'admin.policy.tier-1-caps.updated',
      expect.any(Object),
      expect.any(String),
    );
  });

  it('allows Ops to pause but prevents Admin from changing pilot authority controls', async () => {
    const upsert = jest.fn().mockResolvedValue({
      key: PilotControlKey.INITIATION,
      state: PilotControlState.PAUSED,
    });
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ops_1',
            role: 'OPS',
            mfaVerifiedAt: new Date(),
            blockedAt: null,
          })
          .mockResolvedValueOnce({
            id: 'admin_1',
            role: 'ADMIN',
            mfaVerifiedAt: new Date(),
            blockedAt: null,
          }),
      },
      pilotControl: { upsert },
    } as unknown as PrismaService;
    const service = new AdminService(prisma, audit);

    await expect(
      service.setPilotControl(
        'ops_1',
        PilotControlKey.INITIATION,
        PilotControlState.PAUSED,
        'Partner incident',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ state: PilotControlState.PAUSED }),
    );
    await expect(
      service.setPilotControl(
        'admin_1',
        PilotControlKey.INITIATION,
        PilotControlState.PAUSED,
        'Admin attempt',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('requires the configured accountable pilot operator to start or permanently stop', async () => {
    process.env.PILOT_OPERATOR_ID = 'operator_1';
    const upsert = jest
      .fn()
      .mockResolvedValue({ state: PilotControlState.PERMANENTLY_STOPPED });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotControl: { upsert },
    } as unknown as PrismaService;
    await expect(
      new AdminService(prisma).setPilotControl(
        'ops_1',
        PilotControlKey.GLOBAL,
        PilotControlState.PERMANENTLY_STOPPED,
        'Permanent stop',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    delete process.env.PILOT_OPERATOR_ID;
  });

  it('fails closed when global pilot start has no published no-waiver record', async () => {
    process.env.PILOT_OPERATOR_ID = 'operator_1';
    const upsert = jest.fn();
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'operator_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotReleaseRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      pilotControl: { upsert },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).setPilotControl(
        'operator_1',
        PilotControlKey.GLOBAL,
        PilotControlState.ENABLED,
        'Start pilot',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
    delete process.env.PILOT_OPERATOR_ID;
  });

  it('allows only the configured engineering lead to isolate provider movement', async () => {
    process.env.ENGINEERING_LEAD_ID = 'engineering_1';
    const upsert = jest.fn().mockResolvedValue({
      key: PilotControlKey.CORRIDOR_PROVIDER,
      state: PilotControlState.PAUSED,
    });
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'engineering_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotControl: { upsert },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma, audit).isolateProviderMovement(
        'engineering_1',
        'Partner outage',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ state: PilotControlState.PAUSED }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: PilotControlKey.CORRIDOR_PROVIDER },
        create: expect.objectContaining({ state: PilotControlState.PAUSED }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'admin.engineering-isolation.provider-paused',
      }),
    );
    delete process.env.ENGINEERING_LEAD_ID;
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

  it('assigns and escalates reconciliation ownership with an audit record', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const update = jest.fn().mockResolvedValue({ id: 'recon_1' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ops_1',
            role: 'OPS',
            mfaVerifiedAt: new Date(),
            blockedAt: null,
          })
          .mockResolvedValueOnce({
            id: 'recon_owner_1',
            role: 'OPS',
            blockedAt: null,
          }),
      },
      transactionReconciliation: { update },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma, audit).assignReconciliation(
        'ops_1',
        'recon_1',
        'recon_owner_1',
        'Daily discrepancy review',
        true,
      ),
    ).resolves.toEqual({ id: 'recon_1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'recon_1' },
        data: expect.objectContaining({
          discrepancyOwnerIdentityId: 'recon_owner_1',
          escalatedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.reconciliation.escalated' }),
    );
  });

  it('records Ops alert acknowledgement and escalation evidence', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const update = jest.fn().mockResolvedValue({ id: 'alert_1' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      adminAlertDelivery: { update },
    } as unknown as PrismaService;
    const service = new AdminService(prisma, audit);

    await expect(
      service.acknowledgeAlert('ops_1', 'alert_1', 'Investigating'),
    ).resolves.toEqual({ id: 'alert_1' });
    await expect(
      service.escalateAlert('ops_1', 'alert_1', 'Needs accountable operator'),
    ).resolves.toEqual({ id: 'alert_1' });
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          acknowledgedByIdentityId: 'ops_1',
          acknowledgedAt: expect.any(Date),
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          escalatedByIdentityId: 'ops_1',
          escalatedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.alert.acknowledged' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.alert.escalated' }),
    );
  });
});
