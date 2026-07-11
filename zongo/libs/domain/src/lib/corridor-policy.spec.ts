import type { Corridor } from './corridor';
import type { CorridorPolicy } from './corridor-policy';

describe('Corridor policy', () => {
  it('is independent from the corridor entity', () => {
    const corridor: Corridor = {
      id: 'corr_1',
      code: 'DRC-KE',
      displayName: 'DRC to Kenya',
      active: true,
    };

    const policy: CorridorPolicy = {
      corridorCode: 'DRC-KE',
      maxAmount: 1000,
      supportsCollection: true,
      supportsPayout: false,
      requiresManualReview: true,
    };

    expect(corridor.code).toEqual(policy.corridorCode);
    expect(corridor.displayName).toBeDefined();
    expect(policy.corridorCode).toBe(corridor.code);
    expect(corridor).not.toHaveProperty('maxAmount');
    expect(corridor).not.toHaveProperty('supportsPayout');

    const changedPolicy: CorridorPolicy = { ...policy, maxAmount: 2_000 };
    expect(changedPolicy.maxAmount).toBe(2_000);
    expect(corridor).toEqual(expect.objectContaining({ code: 'DRC-KE' }));
  });
});
