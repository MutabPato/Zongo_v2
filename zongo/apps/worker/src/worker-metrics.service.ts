import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/db';
import {
  AdminAlertDeliveryStatus,
  JobStatus,
  JobType,
  ReconciliationStatus,
  TransactionStatus,
  VerificationStatus,
} from '@prisma/client';

/**
 * Exposes aggregate, non-sensitive operational facts for internal scraping
 * and incident evidence. It deliberately never returns customer or provider
 * identifiers.
 */
@Injectable()
export class WorkerMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const [
      transfers,
      activeJobs,
      failedJobs,
      verifications,
      pendingNotifications,
      mismatchedReconciliations,
      pausedControls,
      pendingAlerts,
    ] = await Promise.all([
      this.prisma.transferTransaction.count(),
      this.prisma.workerJob.count({
        where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      }),
      this.prisma.workerJob.count({ where: { status: JobStatus.FAILED } }),
      this.prisma.senderVerification.count({
        where: {
          status: {
            in: [
              VerificationStatus.TECHNICAL_REVIEW,
              VerificationStatus.HUMAN_REVIEW,
            ],
          },
        },
      }),
      this.prisma.notificationIntent.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.transactionReconciliation.count({
        where: {
          status: {
            in: [
              ReconciliationStatus.MISMATCH,
              ReconciliationStatus.MISSING_COLLECTION_ENTRY,
              ReconciliationStatus.MISSING_PAYOUT_ENTRY,
            ],
          },
        },
      }),
      this.prisma.pilotControl.count({
        where: { state: { not: 'ENABLED' } },
      }),
      this.prisma.adminAlertDelivery.count({
        where: {
          status: {
            in: [
              AdminAlertDeliveryStatus.PENDING,
              AdminAlertDeliveryStatus.FAILED,
            ],
          },
        },
      }),
    ]);

    const transferStatuses = await Promise.all(
      [
        TransactionStatus.INITIATED,
        TransactionStatus.PENDING_COLLECTION,
        TransactionStatus.COLLECTION_SUCCESS,
        TransactionStatus.COLLECTION_FAILED,
        TransactionStatus.PENDING_PAYOUT,
        TransactionStatus.PAYOUT_SUCCESS,
        TransactionStatus.PAYOUT_FAILED,
      ].map(
        async (status) =>
          [
            status,
            await this.prisma.transferTransaction.count({ where: { status } }),
          ] as const,
      ),
    );
    const jobsByType = await Promise.all(
      [
        JobType.COLLECTION,
        JobType.PAYOUT,
        JobType.STATUS_RECHECK,
        JobType.NOTIFICATION,
        JobType.RECONCILIATION,
      ].map(
        async (jobType) =>
          [
            jobType,
            await this.prisma.workerJob.count({ where: { jobType } }),
          ] as const,
      ),
    );

    return {
      generatedAt: new Date().toISOString(),
      transfers: {
        total: transfers,
        byStatus: Object.fromEntries(transferStatuses),
      },
      worker: {
        activeJobs,
        failedJobs,
        jobsByType: Object.fromEntries(jobsByType),
      },
      kyc: { reviewQueue: verifications },
      notifications: { pending: pendingNotifications },
      reconciliation: { mismatches: mismatchedReconciliations },
      controls: { paused: pausedControls },
      alerts: { pendingOrFailed: pendingAlerts },
    };
  }
}
