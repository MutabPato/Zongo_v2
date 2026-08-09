/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { PrismaService } from '@app/db';
import type { BeneficiaryService } from '@app/beneficiary';
import {
  hashPilotReleasePublication,
  signPilotReleasePublication,
} from '@app/observability';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PilotControlKey, PilotControlState } from '@prisma/client';

describe('AdminService', () => {
  it.each([
    ['SUPPORT', false, false],
    ['OPS', true, false],
    ['ADMIN', true, true],
  ])(
    'derives server capabilities for %s sessions',
    async (role, canViewAlerts, canManageAdminControls) => {
      const expiresAt = new Date(Date.now() + 60_000);
      const prisma = {
        adminSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'session_1',
            revokedAt: null,
            expiresAt,
            identity: { id: 'identity_1' },
          }),
          update: jest.fn().mockResolvedValue(undefined),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            expiresAt,
            lastUsedAt: expiresAt,
            source: 'TOTP',
          }),
        },
        platformIdentity: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'identity_1',
            userId: `${String(role).toLowerCase()}@example.test`,
            role,
            mfaVerifiedAt: new Date(),
            blockedAt: null,
          }),
        },
      } as unknown as PrismaService;

      await expect(
        new AdminService(prisma).sessionDetails('token'),
      ).resolves.toEqual(
        expect.objectContaining({
          role,
          capabilities: expect.objectContaining({
            viewAlerts: canViewAlerts,
            manageAdminControls: canManageAdminControls,
          }),
        }),
      );
    },
  );

  it('rejects a revoked admin session', async () => {
    const prisma = {
      adminSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session_1',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          identity: { id: 'admin_1' },
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).actorFromSession('token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns Support-visible operation and reconciliation queues without alert data', async () => {
    const failed = [{ id: 'failed_1', amountMinor: 125n }];
    const pending = [{ id: 'pending_1', amountMinor: 200n }];
    const reconciliation = [{ id: 'reconciliation_1' }];
    const transferFindMany = jest
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(pending);
    const reconciliationFindMany = jest.fn().mockResolvedValue(reconciliation);
    const alertFindMany = jest.fn();
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
      transferTransaction: { findMany: transferFindMany },
      transactionReconciliation: { findMany: reconciliationFindMany },
      auditEvent: { findMany: alertFindMany },
      adminAlertDelivery: { findMany: alertFindMany },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).dashboard('support_1'),
    ).resolves.toEqual(
      expect.objectContaining({
        failed: [{ id: 'failed_1', amountMinor: '125' }],
        pending: [{ id: 'pending_1', amountMinor: '200' }],
        reconciliation,
        alerts: [],
      }),
    );
    expect(alertFindMany).not.toHaveBeenCalled();
  });

  it('revokes an active session with an auditable reason', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      adminSession: { updateMany },
    } as unknown as PrismaService;

    await new AdminService(prisma).revokeSession('token', 'manual logout');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null }),
        data: expect.objectContaining({ revocationReason: 'manual logout' }),
      }),
    );
  });

  it('audits browser logout while revoking the durable session', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      adminSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session_1',
          source: 'TOTP',
          identity: {
            id: 'admin_1',
            userId: 'admin@example.test',
            role: 'ADMIN',
            mfaVerifiedAt: new Date(),
            blockedAt: null,
          },
        }),
        updateMany,
      },
    } as unknown as PrismaService;

    await new AdminService(prisma, audit).logoutSession('token');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revocationReason: 'logout' }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.logout' }),
    );
  });

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
          createdAt: new Date('2026-08-09T08:00:00.000Z'),
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
        createdAt: '2026-08-09T08:00:00.000Z',
      }),
    );
    const result = await new AdminService(prisma).searchTransaction(
      'support_1',
      'ZNG-2026-0001',
    );
    expect(JSON.stringify(result)).not.toContain('pretium-secret-ref');
    expect(JSON.stringify(result)).not.toContain('+254700000001');
  });

  it('does not expose identity secrets or operational stack traces in read models', () => {
    const service = new AdminService({} as PrismaService);
    const masked = (
      service as unknown as { maskAdminData: (value: unknown) => unknown }
    ).maskAdminData({
      actor: { totpSecret: 'totp', userId: 'ops@example.test' },
      lastError: 'Error: database password leaked',
      createdAt: new Date('2026-08-09T08:00:00.000Z'),
    }) as Record<string, unknown>;
    expect(masked).toEqual({
      actor: { totpSecret: '[REDACTED]', userId: 'ops@example.test' },
      lastError: '[REDACTED]',
      createdAt: '2026-08-09T08:00:00.000Z',
    });
  });

  it('keeps reference search usable when optional blind-index keys are absent', async () => {
    const transactionFindMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'tx_1', reference: 'ZNG-2026-0001', amountMinor: 100n },
      ]);
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
      senderProfile: { findMany: jest.fn().mockResolvedValue([]) },
      transferTransaction: {
        findMany: transactionFindMany,
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).searchOperations('support_1', {
        q: 'ZNG-2026-0001',
      }),
    ).resolves.toEqual({
      items: [{ id: 'tx_1', reference: 'ZNG-2026-0001', amountMinor: '100' }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it('keeps Support beneficiary review and reconciliation reads available', async () => {
    const identity = {
      id: 'support_1',
      role: 'SUPPORT',
      mfaVerifiedAt: new Date(),
      blockedAt: null,
    };
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(identity),
      },
      beneficiary: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'beneficiary_1',
            displayName: 'Masked beneficiary',
            phoneNumber: '+254700000001',
          },
        ]),
      },
      transactionReconciliation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'reconciliation_1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const service = new AdminService(prisma);

    await expect(service.reviewBeneficiaries('support_1', {})).resolves.toEqual(
      [
        {
          id: 'beneficiary_1',
          displayName: 'Masked beneficiary',
          phoneNumber: '[MASKED]',
        },
      ],
    );
    await expect(service.listReconciliations('support_1')).resolves.toEqual({
      items: [{ id: 'reconciliation_1' }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  });

  it('paginates beneficiary review before revealing and masking records', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'beneficiary_2', displayName: 'Second beneficiary' },
      ]);
    const count = jest.fn().mockResolvedValue(41);
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'support_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      beneficiary: { findMany, count },
    } as unknown as PrismaService;
    const reviewForOpsPage = jest.fn().mockResolvedValue({
      items: [{ id: 'beneficiary_2', displayName: 'Second beneficiary' }],
      total: 41,
    });
    const beneficiaries = {
      reviewForOpsPage,
    } as unknown as BeneficiaryService;

    await expect(
      new AdminService(
        prisma,
        undefined,
        undefined,
        beneficiaries,
      ).reviewBeneficiariesPage('support_1', { page: 2, pageSize: 10 }),
    ).resolves.toEqual({
      items: [{ id: 'beneficiary_2', displayName: 'Second beneficiary' }],
      page: 2,
      pageSize: 10,
      total: 41,
    });
    expect(reviewForOpsPage).toHaveBeenCalledWith(
      { search: undefined, corridorId: undefined, userId: undefined },
      { skip: 10, take: 10 },
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('paginates and masks the beneficiary fallback when the domain service is unavailable', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'beneficiary_3',
        displayName: 'Fallback beneficiary',
        phoneNumberCiphertext: { ciphertext: 'secret' },
      },
    ]);
    const count = jest.fn().mockResolvedValue(12);
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'support_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      beneficiary: { findMany, count },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).reviewBeneficiariesPage('support_1', {
        search: 'fallback',
        page: 3,
        pageSize: 4,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'beneficiary_3',
          displayName: 'Fallback beneficiary',
          phoneNumberCiphertext: '[REDACTED]',
        },
      ],
      page: 3,
      pageSize: 4,
      total: 12,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 8, take: 4 }),
    );
    expect(count).toHaveBeenCalledWith(expect.any(Object));
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
    const setGlobalTierLimits = jest.fn().mockResolvedValue({
      id: 'policy_1',
      perTransferLimitMinor: 500_000n,
      dailyLimitMinor: 1_000_000n,
    });
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

    await expect(
      new AdminService(
        prisma,
        audit,
        undefined,
        undefined,
        { setGlobalTierLimits } as never,
        alerts,
      ).setTier1TransferCaps('admin_1', 500_000n, 1_000_000n),
    ).resolves.toEqual({
      id: 'policy_1',
      perTransferLimitMinor: '500000',
      dailyLimitMinor: '1000000',
    });

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

  it('fails closed when the published release fingerprint is tampered', async () => {
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          stage: 'PILOT_READY',
          noWaiverConfirmed: true,
          publishedAt: new Date(),
          publishedByIdentityId: 'operator_1',
          publicationHash: 'a'.repeat(64),
          approvedCohort: { senderIds: ['sender_1'] },
          numericLimits: { dailySendMinor: '100000' },
          releaseConfiguration: { corridor: 'DRC-KENYA' },
          rollbackPlan: 'pause',
          evidenceRefs: { kyc: 'evidence://kyc' },
          approvals: [],
          stageRecords: [],
        }),
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
    ).rejects.toThrow(
      'Pilot Ready evidence and no-waiver approval are required before global start',
    );
    expect(upsert).not.toHaveBeenCalled();
    delete process.env.PILOT_OPERATOR_ID;
  });

  it('fails closed when a valid publication lacks provider and key configuration', async () => {
    const signingKey = Buffer.alloc(32, 7).toString('base64url');
    const publishedAt = new Date('2026-08-08T23:00:00.000Z');
    const snapshot = {
      approvedCohort: { senderIds: ['sender_1'] },
      numericLimits: { dailySendMinor: '100000' },
      releaseConfiguration: { corridor: 'DRC-KENYA' },
      rollbackPlan: 'pause',
      evidenceRefs: { kyc: 'evidence://kyc' },
      noWaiverConfirmed: true,
      approvals: [],
      stageRecords: [],
      publishedAt: publishedAt.toISOString(),
      publishedByIdentityId: 'operator_1',
    };
    const publicationHash = hashPilotReleasePublication(snapshot);
    const upsert = jest.fn();
    process.env.PILOT_OPERATOR_ID = 'operator_1';
    process.env.PILOT_RELEASE_SIGNING_KEY = signingKey;
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          stage: 'PILOT_READY',
          ...snapshot,
          noWaiverConfirmed: true,
          publishedAt,
          publishedByIdentityId: 'operator_1',
          publicationHash,
          publicationSignature: signPilotReleasePublication(
            publicationHash,
            signingKey,
          ),
        }),
      },
      pilotControl: { upsert },
    } as unknown as PrismaService;

    try {
      await expect(
        new AdminService(prisma).setPilotControl(
          'operator_1',
          PilotControlKey.GLOBAL,
          PilotControlState.ENABLED,
          'Start pilot',
        ),
      ).rejects.toThrow(
        'Pilot Ready evidence and no-waiver approval are required before global start',
      );
      expect(upsert).not.toHaveBeenCalled();
    } finally {
      delete process.env.PILOT_OPERATOR_ID;
      delete process.env.PILOT_RELEASE_SIGNING_KEY;
    }
  });

  it('records a named readiness approval before publication', async () => {
    process.env.ENGINEERING_LEAD_ID = 'engineering_1';
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'engineering_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotReleaseRecord: {
        upsert: jest.fn().mockResolvedValue({ id: 'pilot' }),
      },
      pilotReleaseApproval: {
        upsert: jest.fn().mockResolvedValue({ id: 'approval_1' }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).recordPilotApproval(
        'engineering_1',
        'ENGINEERING',
        'Engineering review complete',
      ),
    ).resolves.toEqual({ id: 'approval_1' });
    delete process.env.ENGINEERING_LEAD_ID;
  });

  it('preserves a separately verifiable Foundation readiness stage snapshot', async () => {
    process.env.ENGINEERING_LEAD_ID = 'engineering_1';
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const stageCreate = jest.fn().mockResolvedValue({ id: 'stage_1' });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'engineering_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotReleaseRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          stage: 'FOUNDATION_COMPLETE',
          approvals: [{ role: 'ENGINEERING' }],
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'pilot' }),
      },
      pilotReadinessStageRecord: { create: stageCreate },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma, audit).recordPilotReadinessStage(
        'engineering_1',
        'FOUNDATION_COMPLETE',
        { evidenceRefs: { unit: 'evidence://unit-tests' } },
      ),
    ).resolves.toEqual({ id: 'stage_1' });
    expect(stageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordId: 'pilot',
          stage: 'FOUNDATION_COMPLETE',
        }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin.pilot-readiness.stage-recorded' }),
    );
    delete process.env.ENGINEERING_LEAD_ID;
  });

  it('rejects placeholder readiness evidence at the mutation boundary', async () => {
    process.env.ENGINEERING_LEAD_ID = 'engineering_1';
    const stageCreate = jest.fn();
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'engineering_1',
          role: 'SUPPORT',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotReleaseRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          stage: 'FOUNDATION_COMPLETE',
          approvals: [{ role: 'ENGINEERING' }],
        }),
        upsert: jest.fn(),
      },
      pilotReadinessStageRecord: { create: stageCreate },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).recordPilotReadinessStage(
        'engineering_1',
        'FOUNDATION_COMPLETE',
        { evidenceRefs: { provider: 'TBD' } },
      ),
    ).rejects.toThrow('Stage evidence references are required');
    expect(stageCreate).not.toHaveBeenCalled();
    delete process.env.ENGINEERING_LEAD_ID;
  });

  it('reads staged readiness evidence without allowing a mutation', async () => {
    const readiness = {
      id: 'pilot',
      stage: 'LOCAL_E2E_COMPLETE',
      approvals: [],
      stageRecords: [],
    };
    const findUnique = jest.fn().mockResolvedValue(readiness);
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      pilotReleaseRecord: { findUnique },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).getPilotReadiness('ops_1'),
    ).resolves.toEqual(readiness);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          approvals: expect.any(Object),
          stageRecords: expect.any(Object),
        }),
      }),
    );
  });

  it('cannot publish Pilot Ready before Foundation and Local E2E stage evidence', async () => {
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          approvals: [
            { role: 'ENGINEERING' },
            { role: 'OPERATIONS' },
            { role: 'COMPLIANCE_RISK' },
            { role: 'RECONCILIATION' },
            { role: 'PILOT_OPERATOR' },
          ],
          stageRecords: [],
        }),
        upsert,
      },
    } as unknown as PrismaService;
    const evidenceRefs = {
      kyc: 'evidence://kyc',
      provider: 'evidence://provider',
      security: 'evidence://security',
      dpiaRetention: 'evidence://dpia',
      reconciliation: 'evidence://reconciliation',
      recovery: 'evidence://recovery',
      observability: 'evidence://observability',
      incident: 'evidence://incident',
      customerJourney: 'evidence://journey',
      startRunbook: 'evidence://runbook/start',
      pauseResumeRunbook: 'evidence://runbook/pause-resume',
      permanentStopRunbook: 'evidence://runbook/permanent-stop',
      releaseEvidenceRunbook: 'evidence://runbook/release-evidence',
    };

    await expect(
      new AdminService(prisma).publishPilotReadiness('operator_1', {
        approvedCohort: { senderIds: ['sender_1'] },
        numericLimits: { dailySendMinor: '100000' },
        releaseConfiguration: { corridor: 'DRC-KENYA' },
        rollbackPlan:
          'Pause all movement controls and reconcile open transfers.',
        evidenceRefs,
        noWaiverConfirmed: true,
      }),
    ).rejects.toThrow(
      'Foundation Complete evidence must be recorded before Pilot Ready',
    );
    expect(upsert).not.toHaveBeenCalled();
    delete process.env.PILOT_OPERATOR_ID;
  });

  it('persists and audits a fingerprinted Pilot Ready publication', async () => {
    process.env.PILOT_OPERATOR_ID = 'operator_1';
    process.env.PILOT_RELEASE_SIGNING_KEY = Buffer.alloc(32, 7).toString(
      'base64url',
    );
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const upsert = jest.fn().mockResolvedValue({
      id: 'pilot',
      stage: 'PILOT_READY',
      publicationHash: 'a'.repeat(64),
    });
    const now = new Date('2026-08-08T23:00:00.000Z');
    const stage = (id: string, stageName: string) => ({
      id,
      stage: stageName,
      evidenceRefs: { evidence: `evidence://${id}` },
      approvedCohort: null,
      numericLimits: null,
      releaseConfiguration: null,
      rollbackPlan: null,
      noWaiverConfirmed: false,
      recordedByIdentityId: 'operator_1',
      recordedAt: now,
    });
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'pilot',
          approvals: [
            'ENGINEERING',
            'OPERATIONS',
            'COMPLIANCE_RISK',
            'RECONCILIATION',
            'PILOT_OPERATOR',
          ].map((role) => ({
            role,
            actorIdentityId: `${role.toLowerCase()}_1`,
            note: `${role} approved`,
            approvedAt: now,
          })),
          stageRecords: [
            stage('foundation_1', 'FOUNDATION_COMPLETE'),
            stage('e2e_1', 'LOCAL_E2E_COMPLETE'),
          ],
        }),
        upsert,
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma, audit).publishPilotReadiness('operator_1', {
        approvedCohort: { senderIds: ['sender_1'] },
        numericLimits: { dailySendMinor: '100000' },
        releaseConfiguration: { corridor: 'DRC-KENYA' },
        rollbackPlan: 'Pause movement and reconcile open transfers.',
        evidenceRefs: {
          kyc: 'evidence://kyc',
          provider: 'evidence://provider',
          security: 'evidence://security',
          dpiaRetention: 'evidence://dpia',
          reconciliation: 'evidence://reconciliation',
          recovery: 'evidence://recovery',
          observability: 'evidence://observability',
          incident: 'evidence://incident',
          customerJourney: 'evidence://journey',
          startRunbook: 'evidence://runbook/start',
          pauseResumeRunbook: 'evidence://runbook/pause-resume',
          permanentStopRunbook: 'evidence://runbook/permanent-stop',
          releaseEvidenceRunbook: 'evidence://runbook/release-evidence',
        },
        noWaiverConfirmed: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ stage: 'PILOT_READY' }));

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          publicationSignature: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          publishedByIdentityId: 'operator_1',
          publishedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          publicationSignature: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          publishedByIdentityId: 'operator_1',
        }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'admin.pilot-readiness.published',
        payload: expect.objectContaining({
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
    delete process.env.PILOT_OPERATOR_ID;
    delete process.env.PILOT_RELEASE_SIGNING_KEY;
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

  it('rejects customer identities as reconciliation owners', async () => {
    const update = jest.fn();
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
            id: 'customer_1',
            role: 'CUSTOMER',
            blockedAt: null,
          }),
      },
      transactionReconciliation: { update },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).assignReconciliation(
        'ops_1',
        'recon_1',
        'customer_1',
        'Invalid owner',
      ),
    ).rejects.toThrow('A customer identity cannot own a discrepancy');
    expect(update).not.toHaveBeenCalled();
  });

  it('returns a safe projection when blocking an identity', async () => {
    const upsert = jest.fn().mockResolvedValue({
      id: 'customer_1',
      userId: 'customer@example.test',
      role: 'CUSTOMER',
      blockedAt: new Date(),
      blockedReason: 'fraud review',
      blockedById: 'admin_1',
      mfaVerifiedAt: null,
    });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'admin_1',
          role: 'ADMIN',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
        upsert,
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).setUserBlocked(
        'admin_1',
        'customer@example.test',
        true,
        'fraud review',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'customer_1',
        blockedReason: 'fraud review',
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          totpSecret: expect.anything(),
          hardwareKeyCredentialId: expect.anything(),
        }),
      }),
    );
  });

  it('masks sensitive fields in verification decision results', async () => {
    const profiles = {
      approveVerification: jest.fn().mockResolvedValue({
        profile: {
          id: 'profile_1',
          emailCiphertext: 'encrypted-email',
          senderPhoneNumber: '+254700000001',
          amountMinor: 125n,
        },
        verification: { id: 'verification_1' },
      }),
    };
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(
        prisma,
        undefined,
        undefined,
        undefined,
        profiles as never,
      ).reviewVerification('ops_1', {
        verificationId: 'verification_1',
        decision: 'APPROVED',
        decisionReason: 'Evidence reviewed',
      }),
    ).resolves.toEqual({
      profile: {
        id: 'profile_1',
        emailCiphertext: '[REDACTED]',
        senderPhoneNumber: '[MASKED]',
        amountMinor: '125',
      },
      verification: { id: 'verification_1' },
    });
  });

  it('records Ops alert acknowledgement and escalation evidence', async () => {
    const audit = { append: jest.fn().mockResolvedValue(undefined) };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      adminAlertDelivery: { updateMany },
    } as unknown as PrismaService;
    const service = new AdminService(prisma, audit);

    await expect(
      service.acknowledgeAlert('ops_1', 'alert_1', 'Investigating'),
    ).resolves.toEqual({ id: 'alert_1', handling: 'ACCEPTED' });
    await expect(
      service.escalateAlert('ops_1', 'alert_1', 'Needs accountable operator'),
    ).resolves.toEqual({ id: 'alert_1', handling: 'ACCEPTED' });
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          acknowledgedByIdentityId: 'ops_1',
          acknowledgedAt: expect.any(Date),
        }),
      }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
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

  it('returns a masked alert detail only to Ops and above', async () => {
    const prisma = {
      platformIdentity: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ops_1',
          role: 'OPS',
          mfaVerifiedAt: new Date(),
          blockedAt: null,
        }),
      },
      adminAlertDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'alert_1',
          webhookSecret: 'secret-value',
          status: 'FAILED',
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).alertDetail('ops_1', 'alert_1'),
    ).resolves.toEqual({
      id: 'alert_1',
      webhookSecret: '[REDACTED]',
      status: 'FAILED',
    });
  });
});
