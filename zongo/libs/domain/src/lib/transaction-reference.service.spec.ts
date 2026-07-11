import { TransactionReferenceService } from './transaction-reference.service';

describe('TransactionReferenceService', () => {
  it('generates opaque unique references', () => {
    const service = new TransactionReferenceService();
    const first = service.generate();
    const second = service.generate();

    expect(first).toMatch(/^ZNG-[A-Z0-9]+-[A-Z2-9]{8}$/);
    expect(second).toMatch(/^ZNG-[A-Z0-9]+-[A-Z2-9]{8}$/);
    expect(first).not.toEqual(second);
    expect(first).not.toContain('DRC');
    expect(first).not.toContain('KE');
    expect(first).not.toContain('UG');
  });

  it('is lexically ordered by creation time and has no corridor input', () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000);
    const service = new TransactionReferenceService();

    const first = service.generate();
    const second = service.generate();

    expect(first.localeCompare(second)).toBeLessThan(0);
    jest.restoreAllMocks();
  });
});
