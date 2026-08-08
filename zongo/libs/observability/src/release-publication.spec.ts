import { hashPilotReleasePublication } from './release-publication';

describe('pilot release publication fingerprint', () => {
  it('is stable across object-key ordering', () => {
    const first = hashPilotReleasePublication({
      approvedCohort: { b: 2, a: 1 },
      numericLimits: { daily: 100n },
      releaseConfiguration: { corridor: 'DRC-KE' },
      rollbackPlan: 'pause',
      evidenceRefs: { kyc: 'evidence://kyc' },
      noWaiverConfirmed: true,
    });
    const second = hashPilotReleasePublication({
      approvedCohort: { a: 1, b: 2 },
      numericLimits: { daily: 100n },
      releaseConfiguration: { corridor: 'DRC-KE' },
      rollbackPlan: 'pause',
      evidenceRefs: { kyc: 'evidence://kyc' },
      noWaiverConfirmed: true,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when an approved release fact changes', () => {
    const base = {
      approvedCohort: { senderIds: ['sender-1'] },
      numericLimits: { daily: 100 },
      releaseConfiguration: { corridor: 'DRC-KE' },
      rollbackPlan: 'pause',
      evidenceRefs: { kyc: 'evidence://kyc' },
      noWaiverConfirmed: true,
    };

    expect(hashPilotReleasePublication(base)).not.toBe(
      hashPilotReleasePublication({ ...base, rollbackPlan: 'stop' }),
    );
  });

  it('binds the publication to its approvals and accountable publisher', () => {
    const base = {
      approvedCohort: { senderIds: ['sender-1'] },
      numericLimits: { daily: 100 },
      releaseConfiguration: { corridor: 'DRC-KE' },
      rollbackPlan: 'pause',
      evidenceRefs: { kyc: 'evidence://kyc' },
      noWaiverConfirmed: true,
      approvals: [{ role: 'PILOT_OPERATOR', actorIdentityId: 'operator-1' }],
      stageRecords: [{ stage: 'LOCAL_E2E_COMPLETE', id: 'stage-1' }],
      publishedAt: '2026-08-08T23:00:00.000Z',
      publishedByIdentityId: 'operator-1',
    };

    expect(hashPilotReleasePublication(base)).not.toBe(
      hashPilotReleasePublication({
        ...base,
        publishedByIdentityId: 'operator-2',
      }),
    );
  });
});
