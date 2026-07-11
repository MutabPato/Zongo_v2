import type { Corridor } from './corridor';

describe('Corridor policy', () => {
  it('is independent from the corridor entity', () => {
    const corridor: Corridor = {
      id: 'corr_1',
      code: 'DRC-KE',
      displayName: 'DRC to Kenya',
      active: true,
    };

    const policy = {
      corridorCode: 'DRC-KE',
      maxAmount: 1000,
      supportCollection: true,
      supportsPayout: false,
      requiresManualReview: true,
    };

    expect(corridor.code).toEqual(policy.corridorCode);
    expect(corridor.displayName).toBeDefined();
    expect(policy.corridorCode).toBe(corridor.code);
    expect(corridor).not.toHaveProperty('maxAmount');
    expect(corridor).not.toHaveProperty('supportsPayout');
  });
});
